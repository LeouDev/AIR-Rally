-- Corrects a real classification bug in prevent_booking_tampering() from
-- 20260810000009_paymongo_marketplace.sql, caught before any application
-- code wrote to these columns: platform_fee_amount / venue_amount /
-- paymongo_venue_account_id were guarded as strictly immutable
-- (bypass-only), the same class as price_amount/paid_at — but the actual
-- intended write pattern (see ARCHITECTURE.md's PayMongo Platforms
-- section) is that the booking's own owner sets them once, on their own
-- still-pending booking, at checkout-session-creation time — the exact
-- same moment and same self-service posture as the already-unguarded
-- paymongo_checkout_session_id/payment_provider columns, not the
-- bypass-only paid_at/stripe_payment_intent_id category.
--
-- This is safe to leave owner-writable for the same reason
-- paymongo_checkout_session_id already is: these three columns are a
-- stored AUDIT SNAPSHOT of what was actually sent to PayMongo, never
-- read back to decide what a live checkout session's real split is (the
-- checkout action always recomputes the split fresh from price_amount
-- and passes it directly to createPayMongoCheckoutSession — see
-- lib/actions/checkout.ts). PayMongo's own checkout session, once
-- created, has the real routing baked in and is immutable at PayMongo's
-- end regardless of what this snapshot later says — so a user tampering
-- with their own already-created snapshot can corrupt AIR/Rally's own
-- record-keeping but cannot redirect real funds.
--
-- Purely corrective: removes 3 guard clauses that were never exercised
-- by any application code yet (Phase 3, which would be the first writer,
-- ships in this same migration set). Touches no other column, function,
-- or row.

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
  -- platform_fee_amount / venue_amount / paymongo_venue_account_id are
  -- deliberately NOT guarded here — see this migration's header comment.

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
