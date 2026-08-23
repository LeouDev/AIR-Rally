-- QA traced a real, live money bug tonight: rescheduling a credit-paid
-- confirmed booking destroys the customer's credit.
--
--   cancelBooking()       refuses when credit_amount_applied > 0 — correct.
--   complete_reschedule() cancels the ORIGINAL booking via a raw UPDATE
--                         (confirmed -> cancelled), never through
--                         cancelBooking(), never through
--                         compensateCancelledBooking().
--   restore_credit_on_booking_cancel() (20260810000037) only fires for a
--                         pending -> cancelled transition — deliberately,
--                         because a confirmed booking's credit decision
--                         is "issued explicitly by a server action, never
--                         implicitly here."
--
-- The reschedule RPC performs exactly that transition through a door the
-- credit trigger was never told about. Result: a booking part-paid with
-- AIR/Rally Credits, rescheduled, and the credit is gone — no
-- compensation row, no restore, nothing left that reads
-- credit_amount_applied again.
--
-- THIS IS A STOPGAP, NOT THE FIX. The correct behavior carries the credit
-- forward onto the replacement booking; that's real work in the money
-- path, not appropriate days before launch. Blocking is strictly better
-- than today, because today the option customers are offered silently
-- costs them money. A credit-paid booking simply cannot be rescheduled
-- for now.
--
-- THREE LAYERS, deliberately, mirroring this session's "guard at the
-- mutation, not only the advisory check" rule (prevent_booking_tampering,
-- prevent_post_tampering, etc.):
--
--   1. createReschedule() (src/lib/services/reschedules.ts) — the real
--      guard, checked explicitly at the mutation itself, the same layer
--      cancelBooking()'s own credit_amount_applied rule lives in.
--   2. getRescheduleEligibility() (same file) — so the UI stops offering
--      a reschedule that will be refused. Secondary; advisory only.
--   3. complete_reschedule() itself, here — a backstop. It is the actual
--      door (service_role-only; today's one caller already refuses to
--      reach it), and a guard here is the only one that cannot be
--      bypassed by some FUTURE caller that doesn't independently
--      rediscover this exact interaction. Raises loudly rather than
--      silently returning false: reaching this branch at all means the
--      application-layer guard was bypassed, which is an integrity
--      violation worth surfacing, not a routine no-op like the existing
--      "reschedule not found/not pending" early exit above it.
--
-- NO BACKFILL: any reschedule that already destroyed a customer's credit
-- before this landed is not something this migration can safely correct
-- — we don't know the honest replacement value, same reasoning as every
-- other backfill decision tonight.

create or replace function public.complete_reschedule(
  p_reschedule_id uuid,
  p_refund_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
  v_original_credit integer;
begin
  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status in ('pending_payment', 'pending_refund');

  if not found then
    return false;
  end if;

  select credit_amount_applied into v_original_credit
  from public.bookings where id = v_reschedule.original_booking_id;

  if coalesce(v_original_credit, 0) > 0 then
    raise exception 'complete_reschedule: original booking % has credit_amount_applied > 0 — cancelling it here would destroy that credit with nothing to restore it (restore_credit_on_booking_cancel only fires on a pending->cancelled transition)', v_reschedule.original_booking_id
      using errcode = 'AR001';
  end if;

  -- Defense in depth: even restricted to service_role, a supplied
  -- refund_id must still correspond to a REAL, succeeded refund for the
  -- correct original booking before it's ever attached — the database
  -- enforces this itself rather than trusting the caller's parameter,
  -- per the audit's explicit requirement.
  if p_refund_id is not null then
    if not exists (
      select 1 from public.booking_refunds
      where id = p_refund_id
        and booking_id = v_reschedule.original_booking_id
        and status = 'succeeded'
    ) then
      raise exception 'complete_reschedule: refund % is not a succeeded refund for booking %', p_refund_id, v_reschedule.original_booking_id;
    end if;
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  -- Only ever transitions a still-pending replacement booking — this is
  -- the ONLY thing that ever confirms a reschedule's replacement, for all
  -- three price cases. A price increase deliberately does NOT go through
  -- confirm_booking_payment()/confirm_paymongo_booking_payment(): those
  -- check price_amount = the charged amount, but the customer is only
  -- ever charged the DIFFERENCE, never the replacement's full price, so
  -- that check could never pass. See lib/services/reschedules.ts's
  -- maybeCompleteReschedule()/maybeCompleteRescheduleFromProvider().
  update public.bookings
  set status = 'confirmed', paid_at = coalesce(paid_at, now())
  where id = v_reschedule.new_booking_id and status = 'pending';

  -- Cancels the original exactly like a normal self-cancellation would
  -- (same trigger branch, same cancelled_at semantics) — attributed to
  -- whoever actually initiated the reschedule, not the system. A no-op
  -- (0 rows) if the original was already independently cancelled by the
  -- customer through some other action in the meantime — safe either
  -- way, never leaves two active bookings.
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_reschedule.initiated_by
  where id = v_reschedule.original_booking_id and status = 'confirmed';

  update public.booking_reschedules
  set status = 'completed',
      refund_id = coalesce(p_refund_id, refund_id)
  where id = p_reschedule_id and status in ('pending_payment', 'pending_refund');

  return true;
end;
$$;

revoke all on function public.complete_reschedule(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_reschedule(uuid, uuid) to service_role;
