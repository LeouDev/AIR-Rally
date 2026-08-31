-- `paymongo_payment_id` (121) didn't exist when prevent_booking_tampering()
-- was last written, so it was never added to that trigger's explicit
-- allowlist of guarded columns. Found by `95` before writing anything
-- against it, not after: "Users can update their own bookings" is a
-- real, unrestricted RLS UPDATE policy — the trigger is the ONLY thing
-- protecting any sensitive column, and every sibling money/payment
-- column (paymongo_payment_intent_id, paid_at, platform_fee_amount,
-- etc.) is in the guarded list except this one. Left as-is, a booking's
-- own owner could write ANY value into their own booking's
-- paymongo_payment_id via the ordinary authenticated client — and once
-- requestRefund() reads from it, that becomes a real refund-target-
-- forgery path: a customer pointing their own booking's refund at a
-- different real Payment id.
--
-- Two changes, both required together — a guard with no privileged way
-- to set the real value would just break the feature:
--
-- 1. Add paymongo_payment_id to prevent_booking_tampering()'s guarded
--    list, same shape as every other protected column.
-- 2. Give confirm_paymongo_booking_payment() an optional
--    p_paymongo_payment_id parameter (default null, so the CURRENT
--    webhook route — which doesn't pass it yet — keeps working
--    unchanged) that writes it under the same
--    air_rally.bypass_booking_tampering escape hatch
--    paymongo_payment_intent_id already uses. This is the only
--    privileged path that can set the real value once the trigger
--    guards it.
begin;

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
    if new.paymongo_payment_id is distinct from old.paymongo_payment_id then
      new.paymongo_payment_id := old.paymongo_payment_id;
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

create or replace function public.confirm_paymongo_booking_payment(
  p_booking_id uuid,
  p_paymongo_checkout_session_id text,
  p_paymongo_payment_intent_id text,
  p_expected_amount integer,
  p_expected_currency text,
  p_paymongo_payment_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  update public.bookings
  set status = 'confirmed',
      paymongo_payment_intent_id = p_paymongo_payment_intent_id,
      paymongo_payment_id = p_paymongo_payment_id,
      paid_at = now()
  where id = p_booking_id
    and status = 'pending'
    and payment_provider = 'paymongo'
    and paymongo_checkout_session_id = p_paymongo_checkout_session_id
    and price_amount - credit_amount_applied + processing_fee_amount = p_expected_amount
    and currency = p_expected_currency
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

commit;
