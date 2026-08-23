-- Fixes a narrower, more precise bug than "cancelled_at/cancelled_by are
-- never stamped for the mobile path" — that framing turned out to be
-- wrong on investigation. The stamping mechanism has existed correctly
-- since bookings were introduced (20260810000004) and IS database-level
-- already: prevent_booking_tampering() (BEFORE UPDATE) fills both columns
-- on a genuine pending/confirmed -> cancelled transition, and a direct
-- test confirms it works for an ordinary authenticated caller through
-- exactly the path /api/mobile/cancel uses.
--
-- THE ACTUAL BUG, confirmed by evidence rather than inferred: every
-- cancelled booking on staging with BOTH columns null was created by an
-- account with role = 'admin'. Every cancellation by a non-admin account
-- stamped correctly. prevent_booking_tampering()'s very first line is:
--
--   if public.is_admin() or bypass_guc then return new; end if;
--
-- That gate exists so an admin (or a privileged service-role path) can
-- freely correct booking fields for support purposes without having
-- legitimate changes reverted by the tamper-prevention logic below it.
-- But the auto-stamp on cancellation lives INSIDE that same gate, so it
-- is skipped for exactly the same callers the gate was never meant to
-- exempt from it — an admin's own cancellation has nothing to do with
-- the tampering the gate prevents, and skipping its audit trail is a
-- side effect nobody intended, not a design choice anyone made.
--
-- Production evidence, for the record rather than to downplay this:
-- production's cancelled bookings currently show ZERO both-null rows —
-- no admin has cancelled a production booking yet. The bug is real and
-- latent there, not yet manifested, which is exactly the shape of an
-- issue worth fixing before traffic makes it common rather than after.
--
-- THE FIX: split what the privilege gate protects from what it doesn't.
-- Column-tamper reversion (court_id, price_amount, etc.) still only
-- applies to non-privileged callers, unchanged. The cancellation stamp
-- now runs UNCONDITIONALLY on any genuine pending/confirmed -> cancelled
-- transition, privileged or not — but only fills a column that is
-- currently NULL, so it can never clobber a value a caller explicitly
-- supplied. That idempotent-fill is what keeps two existing paths
-- correct without special-casing them:
--
--   expire_stale_pending_bookings() explicitly sets cancelled_by = null
--   (no actor: it's a cron sweep) alongside its own cancelled_at = now().
--   Both already non-null-or-intentionally-null by the time this trigger
--   runs, so nothing here overwrites them.
--
--   complete_reschedule() explicitly sets cancelled_by = the reschedule's
--   initiated_by, which is the customer who actually triggered the
--   reschedule — not necessarily auth.uid() at the moment this specific
--   UPDATE executes. Overwriting that with auth.uid() would silently
--   misattribute the cancellation. The fill-if-null guard prevents it.
--
-- Verified all four shapes directly against staging inside a rolled-back
-- transaction before writing this: an admin cancelling their own booking
-- (the real bug, now fixed), a regular player cancelling (unchanged,
-- still correct), a sweep-style call with explicit cancelled_by = null
-- (preserved), and a reschedule-style call with an explicit actor
-- differing from the session's own auth.uid() (preserved, not clobbered).
--
-- NOT backfilling existing null rows. Their cancelled_at and cancelled_by
-- would have to be invented — we don't have the real timestamp or actor
-- for a row whose privileged caller left both blank, and fabricating an
-- audit trail is worse than an honest gap. This mirrors the same
-- principle 20260810000078's backfill deliberately did NOT extend to
-- past-dated rows: fix what can be fixed honestly, leave the rest as an
-- honest, visible gap rather than a plausible-looking guess.
create or replace function public.prevent_booking_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privileged boolean := public.is_admin() or coalesce(current_setting('air_rally.bypass_booking_tampering', true), 'false') = 'true';
begin
  if not v_privileged then
    if new.court_id is distinct from old.court_id then
      new.court_id := old.court_id;
    end if;
    if new.user_id is distinct from old.user_id then
      new.user_id := old.user_id;
    end if;
    if new.price_amount is distinct from old.price_amount then
      new.price_amount := old.price_amount;
    end if;
    if new.currency is distinct from old.currency then
      new.currency := old.currency;
    end if;
    if new.start_time is distinct from old.start_time then
      new.start_time := old.start_time;
    end if;
    if new.end_time is distinct from old.end_time then
      new.end_time := old.end_time;
    end if;
    if new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
      new.stripe_payment_intent_id := old.stripe_payment_intent_id;
    end if;
    if new.paid_at is distinct from old.paid_at then
      new.paid_at := old.paid_at;
    end if;
    if new.paymongo_payment_intent_id is distinct from old.paymongo_payment_intent_id then
      new.paymongo_payment_intent_id := old.paymongo_payment_intent_id;
    end if;
    if new.platform_fee_amount is distinct from old.platform_fee_amount then
      new.platform_fee_amount := old.platform_fee_amount;
    end if;
    if new.venue_amount is distinct from old.venue_amount then
      new.venue_amount := old.venue_amount;
    end if;
    if new.paymongo_venue_account_id is distinct from old.paymongo_venue_account_id then
      new.paymongo_venue_account_id := old.paymongo_venue_account_id;
    end if;
    if new.credit_amount_applied is distinct from old.credit_amount_applied then
      new.credit_amount_applied := old.credit_amount_applied;
    end if;
    if new.processing_fee_amount is distinct from old.processing_fee_amount then
      new.processing_fee_amount := old.processing_fee_amount;
    end if;

    if new.status is distinct from old.status then
      if old.status in ('pending', 'confirmed') and new.status = 'cancelled' then
        -- The stamp itself now happens unconditionally below, for every
        -- caller. Nothing to do here but let the transition through.
        null;
      else
        new.status := old.status;
        new.cancelled_at := old.cancelled_at;
        new.cancelled_by := old.cancelled_by;
      end if;
    end if;
  end if;

  -- Runs regardless of privilege. Fill-if-null only, so an explicit value
  -- a caller already set (the sweep's null actor, a reschedule's real
  -- initiated_by) is never overwritten.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.cancelled_at is null then
      new.cancelled_at := now();
    end if;
    if new.cancelled_by is null then
      new.cancelled_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;
