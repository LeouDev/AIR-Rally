-- Phase 4B: payment reconciliation columns + the one function that
-- transitions a booking from pending to confirmed once Stripe payment is
-- verified. Additive only — bookings_no_overlap (the actual double-booking
-- guarantee) is not touched by this file in any way.

alter table public.bookings
  add column stripe_checkout_session_id text unique,
  add column stripe_payment_intent_id text,
  add column paid_at timestamptz;

-- Extends the existing prevent_booking_tampering trigger (see
-- supabase/migrations/20260810000004_bookings.sql) to also guard the two
-- new payment-identity columns against non-admin tampering — the same
-- silent-revert shape it already applies to price_amount/status/etc., so
-- a booking's own user still can't forge "this was paid" by hand.
-- `stripe_checkout_session_id` is deliberately NOT guarded here: the
-- booking's own owner legitimately sets it once, before payment, while
-- attaching a freshly-created Checkout Session to their own pending
-- booking (see lib/actions/checkout.ts) — that's an ordinary, low-stakes
-- self-service update under the existing "own booking" UPDATE policy.
--
-- confirm_booking_payment() below needs to perform the one transition a
-- normal session is never allowed to make (pending -> confirmed) with no
-- session at all (a webhook has no auth.uid()). A transaction-local GUC
-- flag lets that one trusted function bypass the trigger's restriction
-- for its own UPDATE only, without weakening the trigger for anyone else
-- — set_config's third argument (`true`) scopes it to the current
-- transaction, so it can never leak across requests/connections.
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

  if new.status is distinct from old.status then
    if old.status in ('pending', 'confirmed') and new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    else
      new.status := old.status;
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    end if;
  end if;

  return new;
end;
$$;

-- The webhook reconciliation entry point. SECURITY DEFINER, callable with
-- the plain anon key — no service-role credential is used anywhere in
-- this application (see ARCHITECTURE.md's Phase 4B section for why this
-- was chosen over exposing SUPABASE_SECRET_KEY to the server runtime).
--
-- Idempotent by construction: the UPDATE's WHERE clause requires
-- status = 'pending', so a second delivery of the same webhook event
-- finds the booking already 'confirmed' and this affects zero rows —
-- returns false, changes nothing, is safe to call any number of times.
--
-- Also verifies the caller-supplied session id and amount/currency match
-- what's actually stored on that specific booking before transitioning —
-- this is what stops the function from being usable to confirm an
-- unrelated booking even if its id were guessed, since the real
-- Stripe-generated session id is not guessable.
create or replace function public.confirm_booking_payment(
  p_booking_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
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
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      paid_at = now()
  where id = p_booking_id
    and status = 'pending'
    and stripe_checkout_session_id = p_stripe_checkout_session_id
    and price_amount = p_expected_amount
    and currency = p_expected_currency
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

grant execute on function public.confirm_booking_payment(uuid, text, text, integer, text) to anon, authenticated;
