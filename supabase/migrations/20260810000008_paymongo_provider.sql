-- PayMongo TEST MODE: an experimental, switchable second payment
-- provider alongside Stripe (see ARCHITECTURE.md's PayMongo TEST MODE
-- section for the full design). Additive only — does not touch
-- bookings_no_overlap, does not touch any existing Stripe column,
-- function, or policy. Every existing (and every future Stripe-path)
-- booking is unaffected: payment_provider defaults to 'stripe', and the
-- new confirm_paymongo_booking_payment() function is a structural twin
-- of confirm_booking_payment(), never a modification to it.

alter table public.bookings
  add column payment_provider text not null default 'stripe' check (payment_provider in ('stripe', 'paymongo')),
  add column paymongo_checkout_session_id text unique,
  add column paymongo_payment_intent_id text;

-- Extends the existing prevent_booking_tampering trigger (see
-- supabase/migrations/20260810000007_booking_payments.sql) to also guard
-- paymongo_payment_intent_id — the same bypass-only protection already
-- applied to stripe_payment_intent_id, so a booking's own user can't
-- forge "this was paid via PayMongo" by hand.
--
-- payment_provider and paymongo_checkout_session_id are deliberately NOT
-- guarded here, for the exact same reason stripe_checkout_session_id
-- isn't: the booking's own owner legitimately sets both once, before
-- payment, while attaching a freshly-created PayMongo Checkout Session to
-- their own pending booking (see lib/actions/checkout.ts /
-- attachPaymongoCheckoutSession() in lib/services/bookings.ts) — an
-- ordinary, low-stakes self-service update under the existing "own
-- booking" UPDATE policy, not something that needs the trigger's
-- protection.
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

-- The PayMongo webhook reconciliation entry point — a structural twin of
-- confirm_booking_payment(), operating on the paymongo_* columns instead.
-- SECURITY DEFINER, callable with the plain anon key, same reasoning as
-- the Stripe RPC: no service-role credential is used anywhere in this
-- application. Idempotent by construction: the UPDATE's WHERE clause
-- requires status = 'pending', so a second delivery of the same webhook
-- event finds the booking already 'confirmed' and this affects zero rows.
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
    and price_amount = p_expected_amount
    and currency = p_expected_currency
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

grant execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) to anon, authenticated;
