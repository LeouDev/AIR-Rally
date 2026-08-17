-- Processing fee charged to the customer on top of the court price.
--
-- Until now the customer paid exactly the court price and PayMongo's cut
-- came out of AIR/Rally's 5% commission — measured at ₱1.20 of a ₱4.00
-- commission on an ₱80 booking, 30% of margin. With pass_on_fees the
-- customer is charged the grossed-up total instead, and the venue's 95%
-- still comes off the original court price.
--
-- This migration exists because of a live failure. pass_on_fees was
-- enabled without it: PayMongo charged ₱406.09 for a ₱400 court, the
-- Payment reported ₱406.09, and confirm_paymongo_booking_payment()
-- compared that against price_amount (₱400) — zero rows matched, and a
-- genuinely paid booking sat on 'pending' forever. PayMongo's own written
-- answer describes the *Payment Intent* keeping the original amount; the
-- check reads the *Payment*, which is a different resource, and does not.
--
-- ADDITIVE AND BACKWARDS-COMPATIBLE. processing_fee_amount defaults to 0,
-- so every existing row and every in-flight booking behaves exactly as
-- before and the new check term is algebraically identical to the old
-- one. Apply this BEFORE deploying the code that writes a non-zero fee —
-- reversed, the first booking charges the grossed-up total against a
-- database still expecting the bare court price, and nothing confirms.

-- === 1. The column =======================================================

alter table public.bookings
  add column if not exists processing_fee_amount integer not null default 0
  check (processing_fee_amount >= 0);

comment on column public.bookings.processing_fee_amount is
  'PayMongo processing fee charged to the customer on top of price_amount, integer minor units. Computed server-side at checkout by lib/services/bookingFee.ts and never sent from a client. 0 for every booking made before the fee was passed on.';

-- === 2. Guard it against tampering =======================================
--
-- Not optional. Without this a player can run
--   update bookings set processing_fee_amount = 9999999 where id = <mine>;
-- and then satisfy the amount check below with an arbitrary payment —
-- re-opening the free-booking exploit that 20260810000047 closed, through
-- a new door. Identical in shape to the credit_amount_applied guard added
-- in 20260810000038 for exactly the same reason.
--
-- Reproduced verbatim from 20260810000038 with only the
-- processing_fee_amount clause added.

create or replace function public.prevent_booking_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or coalesce(current_setting('air_rally.bypass_booking_tampering', true), 'false') = 'true' then
    return new;
  end if;

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
  -- NEW: the amount check below trusts this column, so nothing but the
  -- service role may ever change it.
  if new.processing_fee_amount is distinct from old.processing_fee_amount then
    new.processing_fee_amount := old.processing_fee_amount;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('pending', 'confirmed') and new.status = 'cancelled' then
      null;
    else
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

-- === 3. Extend the amount-integrity check ================================
--
-- One extra term. The customer is charged
--   price_amount - credit_amount_applied + processing_fee_amount
-- so that is what the Payment must report. With processing_fee_amount = 0
-- this is exactly the previous condition, which is why old rows are
-- unaffected.
--
-- Still expressed as a WHERE clause rather than a raise: a mismatch
-- updates zero rows and returns false, so a redelivered webhook stays
-- idempotent instead of erroring.
--
-- The fee grosses up the POST-CREDIT amount, because PayMongo charges on
-- what is actually collected. A ₱400 booking with ₱100 of credit is
-- charged on ₱300, and its fee must be computed from ₱300 — grossing up
-- from ₱400 would over-charge the customer.

-- Reproduced verbatim from 20260810000038 — parameter names included,
-- since create or replace cannot rename them — with ONE term added to the
-- amount condition. Every other guard is unchanged: payment_provider,
-- the session-id match, the currency match, the status = 'pending'
-- idempotency, and the bypass GUC that lets this function write through
-- prevent_booking_tampering().

create or replace function public.confirm_paymongo_booking_payment(
  p_booking_id uuid,
  p_paymongo_checkout_session_id text,
  p_paymongo_payment_intent_id text,
  p_expected_amount integer,
  p_expected_currency text
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

-- Unchanged from 20260810000047: service_role only. The authority for
-- calling this is a verified webhook signature, which cannot be expressed
-- in SQL, so no browser-reachable role may execute it.
revoke all on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) to service_role;
