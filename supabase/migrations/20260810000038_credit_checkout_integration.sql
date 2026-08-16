-- Wires AIR/Rally Credits into checkout, and closes a hole that 036 opened.
--
-- THE HOLE (verified exploitable on staging before this migration):
-- 036 added bookings.credit_amount_applied and a trigger that returns that
-- amount to the wallet when a pending booking is cancelled. But
-- credit_amount_applied was never added to prevent_booking_tampering(), and
-- bookings' RLS lets a user UPDATE their own row (it must, for
-- cancellation). So:
--
--   update bookings set credit_amount_applied = 9999999 where id = <mine>;
--   update bookings set status = 'cancelled'            where id = <mine>;
--
-- minted ₱99,999.99 of credit from nothing, repeatably. The column is
-- guarded below, which is what makes the whole credits feature safe to
-- expose at checkout at all.
--
-- The rest of this migration is the checkout integration itself. Two new
-- privileged functions, both service_role-only for the same reason
-- issue_credit()/spend_credit() are: the authority is *which code is
-- calling* — a server action that already identified the user — not any
-- value in the request.

-- === 1. Guard credit_amount_applied ======================================
--
-- Every clause from 20260810000009_paymongo_marketplace.sql is reproduced
-- verbatim; only the credit_amount_applied clause is new. The bypass flag
-- is what lets apply_credit_to_booking() below write the column while
-- every client path stays blocked — the same idiom the RPC in
-- 20260810000008 uses to set status/paid_at.
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
  -- New: how much wallet credit was applied. Payable on cancellation, so
  -- a writable value here is a mint.
  if new.credit_amount_applied is distinct from old.credit_amount_applied then
    new.credit_amount_applied := old.credit_amount_applied;
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

-- === 2. The webhook's amount check must account for credit ===============
--
-- Unchanged in every respect except the amount comparison. Previously the
-- charged amount had to equal price_amount exactly; once credit is applied
-- PayMongo is only asked for the remainder, so the correct expectation is
-- price_amount - credit_amount_applied. For every booking with no credit
-- applied (all existing rows, credit_amount_applied defaults to 0) this is
-- arithmetically identical to the old check.
--
-- The check stays strict equality, not a range or a minimum: PayMongo must
-- report exactly what we asked it to charge. Underpaying by any amount
-- still fails to confirm, exactly as before.
--
-- Idempotency is unchanged and still structural: the WHERE clause requires
-- status = 'pending', so a redelivered webhook affects zero rows.
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
    and price_amount - credit_amount_applied = p_expected_amount
    and currency = p_expected_currency
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

-- === 3. Applying credit to a booking =====================================
--
-- Debiting the wallet and recording the debit on the booking must happen
-- together or not at all. supabase-js cannot run a multi-statement
-- transaction, so the pair lives here instead, where plpgsql gives it a
-- single transaction for free. A crash between the two halves is therefore
-- impossible — there is no "between".
--
-- Guards, in order of what each one prevents:
--   * booking must exist, belong to p_user_id, and still be pending —
--     credit cannot be pushed onto a stranger's or an already-paid booking
--   * credit_amount_applied must still be 0 — applying twice would debit
--     the wallet twice for one booking
--   * p_amount must not exceed price_amount — a booking can never absorb
--     more credit than it costs, which would make the "refund" on
--     cancellation larger than the sale
--
-- Sufficiency and the wallet lock are spend_credit()'s job, not repeated
-- here; it raises on an insufficient balance and this function's
-- transaction unwinds with it, leaving credit_amount_applied untouched.
create or replace function public.apply_credit_to_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'Credit amount must be positive.' using errcode = 'check_violation';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Booking not found.' using errcode = 'no_data_found';
  end if;
  if v_booking.user_id is distinct from p_user_id then
    raise exception 'Booking does not belong to this user.' using errcode = 'check_violation';
  end if;
  if v_booking.status <> 'pending' then
    raise exception 'Credit can only be applied to a pending booking.' using errcode = 'check_violation';
  end if;
  if v_booking.credit_amount_applied <> 0 then
    raise exception 'Credit has already been applied to this booking.' using errcode = 'check_violation';
  end if;
  if p_amount > v_booking.price_amount then
    raise exception 'Credit applied cannot exceed the booking price.' using errcode = 'check_violation';
  end if;

  v_balance := public.spend_credit(p_user_id, p_amount, p_booking_id, 'Credits applied to booking #' || v_booking.confirmation_code);

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  update public.bookings
  set credit_amount_applied = p_amount
  where id = p_booking_id;

  return v_balance;
end;
$$;

-- === 4. Confirming a booking paid entirely in credit =====================
--
-- No PayMongo session exists for these, so the webhook can never confirm
-- them and this is the only path that does. The WHERE clause is the whole
-- security argument, and it deliberately mirrors
-- confirm_paymongo_booking_payment()'s shape:
--
--   * status = 'pending'          — idempotent; a redelivery affects 0 rows
--   * credit_amount_applied = price_amount — the booking really is fully
--     covered. A partially covered booking cannot be confirmed here, which
--     is what stops this becoming a free-booking function
--   * price_amount > 0            — a zero-price booking is not "paid in
--     credit"; it never went through checkout at all
--   * no PayMongo session attached — a booking already routed to PayMongo
--     must confirm through the webhook, never here
create or replace function public.confirm_credit_only_booking(
  p_booking_id uuid,
  p_user_id uuid
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
      payment_provider = 'air_rally_credit',
      paid_at = now()
  where id = p_booking_id
    and user_id = p_user_id
    and status = 'pending'
    and price_amount > 0
    and credit_amount_applied = price_amount
    and paymongo_checkout_session_id is null
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

revoke all on function public.apply_credit_to_booking(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.confirm_credit_only_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_credit_to_booking(uuid, uuid, integer) to service_role;
grant execute on function public.confirm_credit_only_booking(uuid, uuid) to service_role;
