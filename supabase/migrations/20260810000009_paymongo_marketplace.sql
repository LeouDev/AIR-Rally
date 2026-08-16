-- PayMongo Platforms/FIaaS marketplace layer — Phase 1 (schema only).
--
-- Adds the minimum columns needed for: (a) linking a venue to a PayMongo
-- Platforms child account and tracking its onboarding/activation status,
-- and (b) snapshotting the exact 95%/5% allocation used for a given
-- booking, immutably, at the moment its PayMongo split checkout session
-- is created.
--
-- Purely additive: no existing column, function, trigger, or policy is
-- dropped or renamed. Stripe's columns/functions/triggers and the
-- existing non-split PayMongo columns/functions from
-- 20260810000008_paymongo_provider.sql are untouched. Reversible: every
-- change here can be undone with `drop column`/`drop function` without
-- touching any other table or existing row's meaning (all new columns
-- are nullable or have safe defaults; no existing row's data changes).
--
-- Confirmed against PayMongo's real API/docs before writing this (see
-- ARCHITECTURE.md's PayMongo Platforms section for the full research
-- log): POST /v2/accounts (type: "merchant") creates a child account
-- with activation_status in {pending, activated, under_review, declined}
-- (confirmed via a real 201 response); the merchant.activated /
-- merchant.declined webhooks are the documented "reliable signal" for
-- activation (a real GET-vs-POST inconsistency was observed in TEST MODE
-- — see ARCHITECTURE.md — which is exactly why activation is tracked via
-- the webhook-driven column below, not inferred from the activate call's
-- own response). 'unlinked' below is AIR/Rally's own sentinel for "no
-- PayMongo account created yet" — it is not a PayMongo-defined value.

-- ---------------------------------------------------------------------
-- Venue-level: link to a PayMongo Platforms child ("merchant") account
-- ---------------------------------------------------------------------

alter table public.venues
  add column paymongo_account_id text unique,
  add column paymongo_activation_status text not null default 'unlinked'
    check (paymongo_activation_status in ('unlinked', 'pending', 'under_review', 'activated', 'declined')),
  add column paymongo_onboarding_started_at timestamptz,
  add column paymongo_activated_at timestamptz,
  add column paymongo_declined_reason text;

comment on column public.venues.paymongo_account_id is
  'The org_... id of this venue''s PayMongo Platforms child (merchant) account. Null until onboarding starts. Never shown to customers (excluded from venue_marketplace).';
comment on column public.venues.paymongo_activation_status is
  'AIR/Rally-tracked mirror of PayMongo''s child-account status, updated only by the merchant.activated/merchant.declined webhook — never inferred from the synchronous activate-call response, which was observed to disagree with a follow-up GET in TEST MODE.';

-- Same defense-in-depth posture as prevent_owner_status_escalation
-- (venues) and prevent_booking_tampering (bookings): a venue owner can
-- read these columns but must never be able to write
-- 'activated'/paymongo_account_id themselves — only the webhook route
-- (via the bypass flag) or an admin can. A brand-new trigger, not a
-- reuse of prevent_owner_status_escalation, since that function guards
-- an unrelated column (status) and has its own comment/scope.
create or replace function public.prevent_venue_paymongo_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or coalesce(current_setting('air_rally.bypass_venue_paymongo_sync', true), 'false') = 'true' then
    return new;
  end if;

  if new.paymongo_account_id is distinct from old.paymongo_account_id then
    new.paymongo_account_id := old.paymongo_account_id;
  end if;
  if new.paymongo_activation_status is distinct from old.paymongo_activation_status then
    new.paymongo_activation_status := old.paymongo_activation_status;
  end if;
  if new.paymongo_onboarding_started_at is distinct from old.paymongo_onboarding_started_at then
    new.paymongo_onboarding_started_at := old.paymongo_onboarding_started_at;
  end if;
  if new.paymongo_activated_at is distinct from old.paymongo_activated_at then
    new.paymongo_activated_at := old.paymongo_activated_at;
  end if;
  if new.paymongo_declined_reason is distinct from old.paymongo_declined_reason then
    new.paymongo_declined_reason := old.paymongo_declined_reason;
  end if;

  return new;
end;
$$;

create trigger venues_prevent_paymongo_tampering
before update on public.venues
for each row execute function public.prevent_venue_paymongo_tampering();

-- Trusted write path for the venue side: called once (owner-initiated,
-- via their own session) when onboarding starts, and again (bypass path)
-- whenever PayMongo's onboarding webhooks report a status change.
-- SECURITY DEFINER + bypass GUC, matching the exact pattern already used
-- by sync's sibling functions in this codebase (confirm_booking_payment,
-- confirm_paymongo_booking_payment).
create or replace function public.sync_venue_paymongo_status(
  p_venue_id uuid,
  p_paymongo_account_id text,
  p_activation_status text,
  p_declined_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_activation_status not in ('unlinked', 'pending', 'under_review', 'activated', 'declined') then
    raise exception 'invalid paymongo activation status: %', p_activation_status;
  end if;

  if not public.is_admin() then
    perform set_config('air_rally.bypass_venue_paymongo_sync', 'true', true);
  end if;

  update public.venues
  set paymongo_account_id = coalesce(p_paymongo_account_id, paymongo_account_id),
      paymongo_activation_status = p_activation_status,
      paymongo_onboarding_started_at = case
        when paymongo_onboarding_started_at is null and p_paymongo_account_id is not null then now()
        else paymongo_onboarding_started_at
      end,
      paymongo_activated_at = case
        when p_activation_status = 'activated' then coalesce(paymongo_activated_at, now())
        else paymongo_activated_at
      end,
      paymongo_declined_reason = case when p_activation_status = 'declined' then p_declined_reason else null end
  where id = p_venue_id
    and (
      (paymongo_account_id is null and owner_id = auth.uid())
      or paymongo_account_id = p_paymongo_account_id
    )
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

grant execute on function public.sync_venue_paymongo_status(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Booking-level: immutable snapshot of the 95%/5% split actually used
-- ---------------------------------------------------------------------

alter table public.bookings
  add column platform_fee_amount integer,
  add column venue_amount integer,
  add column paymongo_venue_account_id text;

comment on column public.bookings.platform_fee_amount is
  'AIR/Rally''s 5% share of price_amount (the original gross booking price), in integer minor units. Computed once at booking creation, never from a post-processing-fee amount. Null for bookings that predate the marketplace split or that use the non-split payment path.';
comment on column public.bookings.venue_amount is
  'The venue''s 95% share: price_amount - platform_fee_amount, always computed by subtraction from the gross amount (never separately rounded), so the two always sum exactly to price_amount.';
comment on column public.bookings.paymongo_venue_account_id is
  'Snapshot of the venue''s paymongo_account_id at the moment this booking''s checkout session was created — the booking row stays self-contained for audit/reconciliation even if the venue''s linked account later changes.';

-- Extends the existing prevent_booking_tampering trigger (see
-- 20260810000007_booking_payments.sql / 20260810000008_paymongo_provider.sql)
-- with the same immutable-snapshot guard already applied to
-- price_amount/currency — these three are computed once, server-side, at
-- booking creation and must never be user-writable afterward. Every
-- existing guard clause is reproduced verbatim; only three new ones are
-- added.
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

-- ---------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------
-- No RLS policy changes needed: RLS is row-level, and every new column
-- on venues/bookings is covered for free by the existing row policies
-- (owner_id = auth.uid() / status = 'active' / is_admin() for venues;
-- user_id = auth.uid() / is_admin() for bookings). venue_marketplace's
-- explicit column list means these new venue columns are NOT exposed to
-- customers unless someone deliberately adds them later — confirmed by
-- inspection, not modified here.
