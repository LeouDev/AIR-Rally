-- QR Ph payments cannot be refunded through PayMongo — ever, confirmed by
-- a live API rejection this codebase already recorded months ago. So a
-- customer who reschedules to a cheaper slot, paid via QR Ph, cannot get
-- cash back. Founder's decision: credit the difference instead.
--
-- `95` established reusing `cancellation_compensation` (the existing
-- credit-issuance path) would be wrong on three counts: its amount is
-- computed from the whole booking rather than passed in, the
-- late-cancellation penalty logic would wrongly apply, and its wrapper
-- is deliberately built to never throw — which would silently break the
-- reschedule saga's failure detection, the exact same "did the financial
-- step actually happen" question `booking_refunds`/`refund_id` already
-- answers for the cash path. And a customer's ledger reading "Credits
-- returned for cancelled booking #X" for a booking they didn't cancel is
-- simply wrong copy.
--
-- ============================================================================
-- credit_transaction_id MIRRORS refund_id — same shape, same reason
-- ============================================================================
--
-- `booking_reschedules.refund_id` is how the saga durably records "the
-- financial step already succeeded, don't redo it" — `record_reschedule_refund_success`
-- sets it, `complete_reschedule`/`mark_reschedule_failed` read it.
-- Without an equivalent for credit, a retry after `addCredit()` succeeds
-- but `complete_reschedule` throws would have no record that credit was
-- already issued, and would issue it again — the exact double-payout
-- shape already fixed on the refund ledger, reproduced on the credit
-- ledger.
--
-- `complete_reschedule` and `mark_reschedule_failed` are WIDENED (not
-- duplicated) to accept `p_credit_transaction_id` alongside `p_refund_id`:
-- their actual job — confirm the new booking, cancel the original,
-- transition the reschedule row — is identical regardless of which
-- compensation mechanism was used; only the reference column differs.
--
-- `record_reschedule_credit_success` is a NEW function rather than a
-- widened `record_reschedule_refund_success`: that function's validation
-- checks a completely different table (`credit_transactions`, not
-- `booking_refunds`) with different columns to verify. There is
-- meaningfully little to share by forcing one function to branch its
-- entire body on which kind of reference it received.
--
-- Exactly one of refund_id/credit_transaction_id may ever be set on a
-- reschedule row — a row with both would mean the customer was
-- compensated twice by two different mechanisms. Enforced by a CHECK,
-- not left to application discipline, for the same reason
-- `booking_refunds_one_pending_per_booking` and this migration's own
-- guarded-column trigger exist: a "this happened exactly once" property
-- with no database expression is a property that eventually isn't true.
--
-- ============================================================================
-- STATUS RENAMED, NOT DUPLICATED: pending_refund -> pending_completion
-- ============================================================================
--
-- `record_reschedule_refund_success` transitions the reschedule to
-- `pending_refund` — "the financial step succeeded, completion hasn't
-- happened yet." That is true regardless of which mechanism the money
-- moved through. Naming the status after the CASH mechanism specifically
-- would mean every future compensation mechanism needs its own status
-- value; naming it after the STATE means none do. Renamed rather than
-- adding `pending_credit` alongside it — confirmed directly, zero rows
-- carry this status on staging or production, so the rename costs
-- nothing to migrate.
--
-- Checked before renaming: no runtime switch/crash risk anywhere on this
-- enum. The only exhaustive consumer is a `Record<RescheduleStatus,
-- string>` type in the admin payments web page — compile-time checked,
-- not a shipped binary; a missing key fails the BUILD, not a live
-- crash — plus several string-equality checks in
-- `lib/services/reschedules.ts`. Mobile has no branching on this enum at
-- all. Application code (the admin page's labels, `reschedules.ts`'s
-- string comparisons) is NOT changed here — that's `95`'s side, handed
-- the exact call sites separately, since they're actively working in
-- that file and this migration shouldn't collide with it.
--
-- ============================================================================
-- transaction_type: SIX VALUES, NOT FIVE
-- ============================================================================
--
-- The live constraint already has five values, not the four migration
-- 036 originally wrote — `account_deletion_forfeiture` was added later.
-- Checked the deployed constraint directly rather than the original
-- migration file. `reschedule_compensation` is the sixth.
--
-- Not applied to production tonight — the founder is asleep and this
-- migration's exact final shape (the status rename in particular)
-- postdates the blanket approval they gave before going to sleep.
-- Staging only; their own direct word, awake, before this goes further.
begin;

alter table public.booking_reschedules
  drop constraint booking_reschedules_status_check;

update public.booking_reschedules set status = 'pending_completion' where status = 'pending_refund';

alter table public.booking_reschedules
  add constraint booking_reschedules_status_check
  check (status in ('pending_payment', 'pending_completion', 'completed', 'failed', 'provider_unavailable'));

alter table public.booking_reschedules
  add column credit_transaction_id uuid references public.credit_transactions (id);

comment on column public.booking_reschedules.credit_transaction_id is
  'Set only once a credit-compensation transaction has actually been '
  'issued for this reschedule (QR Ph price-decrease case, where a cash '
  'refund is impossible) — mirrors refund_id exactly, for the same reason: '
  'a durable record that the financial step already happened, so a retry '
  'never redoes it.';

alter table public.booking_reschedules
  add constraint booking_reschedules_one_compensation_mechanism
  check (not (refund_id is not null and credit_transaction_id is not null));

alter table public.credit_transactions
  drop constraint credit_transactions_transaction_type_check;

alter table public.credit_transactions
  add constraint credit_transactions_transaction_type_check
  check (transaction_type in (
    'cancellation_compensation', 'admin_adjustment', 'promotion_bonus',
    'booking_payment', 'account_deletion_forfeiture', 'reschedule_compensation'
  ));

create or replace function public.prevent_reschedule_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.original_booking_id := old.original_booking_id;
  new.new_booking_id := old.new_booking_id;
  new.price_difference := old.price_difference;
  new.initiated_by := old.initiated_by;
  new.reason := old.reason;

  if coalesce(current_setting('air_rally.bypass_reschedule_tampering', true), 'false') <> 'true' then
    new.status := old.status;
    new.failure_reason := old.failure_reason;
    new.refund_id := old.refund_id;
    new.credit_transaction_id := old.credit_transaction_id;
  end if;

  return new;
end;
$$;

create or replace function public.complete_reschedule(
  p_reschedule_id uuid,
  p_refund_id uuid default null,
  p_credit_transaction_id uuid default null
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
  where id = p_reschedule_id and status in ('pending_payment', 'pending_completion');

  if not found then
    return false;
  end if;

  select credit_amount_applied into v_original_credit
  from public.bookings where id = v_reschedule.original_booking_id;

  if coalesce(v_original_credit, 0) > 0 then
    raise exception 'complete_reschedule: original booking % has credit_amount_applied > 0 — cancelling it here would destroy that credit with nothing to restore it (restore_credit_on_booking_cancel only fires on a pending->cancelled transition)', v_reschedule.original_booking_id
      using errcode = 'AR001';
  end if;

  -- Defense in depth, same shape as the refund check below: a supplied
  -- reference must still correspond to a REAL compensation transaction
  -- for the correct booking before it's ever attached.
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

  if p_credit_transaction_id is not null then
    if not exists (
      select 1 from public.credit_transactions
      where id = p_credit_transaction_id
        and reference_id = v_reschedule.original_booking_id
        and transaction_type = 'reschedule_compensation'
    ) then
      raise exception 'complete_reschedule: credit transaction % is not a reschedule_compensation for booking %', p_credit_transaction_id, v_reschedule.original_booking_id;
    end if;
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  update public.bookings
  set status = 'confirmed', paid_at = coalesce(paid_at, now())
  where id = v_reschedule.new_booking_id and status = 'pending';

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_reschedule.initiated_by
  where id = v_reschedule.original_booking_id and status = 'confirmed';

  update public.booking_reschedules
  set status = 'completed',
      refund_id = coalesce(p_refund_id, refund_id),
      credit_transaction_id = coalesce(p_credit_transaction_id, credit_transaction_id)
  where id = p_reschedule_id and status in ('pending_payment', 'pending_completion');

  return true;
end;
$$;

create or replace function public.mark_reschedule_failed(
  p_reschedule_id uuid,
  p_status text,
  p_failure_reason text,
  p_refund_id uuid default null,
  p_credit_transaction_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
begin
  if p_status not in ('failed', 'provider_unavailable') then
    raise exception 'mark_reschedule_failed: invalid status %', p_status;
  end if;

  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status = 'pending_payment';

  if not found then
    return false;
  end if;

  if p_refund_id is not null then
    if not exists (
      select 1 from public.booking_refunds
      where id = p_refund_id
        and booking_id = v_reschedule.original_booking_id
        and status in ('provider_unavailable', 'failed')
    ) then
      raise exception 'mark_reschedule_failed: refund % is not a failed/provider_unavailable refund for booking %', p_refund_id, v_reschedule.original_booking_id;
    end if;
  end if;

  if p_credit_transaction_id is not null then
    if not exists (
      select 1 from public.credit_transactions
      where id = p_credit_transaction_id
        and reference_id = v_reschedule.original_booking_id
        and transaction_type = 'reschedule_compensation'
    ) then
      raise exception 'mark_reschedule_failed: credit transaction % is not a reschedule_compensation for booking %', p_credit_transaction_id, v_reschedule.original_booking_id;
    end if;
  end if;

  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  update public.booking_reschedules
  set status = p_status,
      failure_reason = p_failure_reason,
      refund_id = coalesce(p_refund_id, refund_id),
      credit_transaction_id = coalesce(p_credit_transaction_id, credit_transaction_id)
  where id = p_reschedule_id and status = 'pending_payment';

  return true;
end;
$$;

create or replace function public.record_reschedule_credit_success(
  p_reschedule_id uuid,
  p_credit_transaction_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
begin
  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status = 'pending_payment';

  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.credit_transactions
    where id = p_credit_transaction_id
      and reference_id = v_reschedule.original_booking_id
      and transaction_type = 'reschedule_compensation'
  ) then
    raise exception 'record_reschedule_credit_success: credit transaction % is not a reschedule_compensation for booking %', p_credit_transaction_id, v_reschedule.original_booking_id;
  end if;

  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  update public.booking_reschedules
  set status = 'pending_completion',
      credit_transaction_id = p_credit_transaction_id
  where id = p_reschedule_id and status = 'pending_payment';

  return true;
end;
$$;

commit;
