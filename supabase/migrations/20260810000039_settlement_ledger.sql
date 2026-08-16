-- The settlement ledger: what each venue is OWED for a booking, recorded
-- independently of how the customer happened to pay for it.
--
-- WHY THIS IS NEEDED (from the pre-design audit):
--
-- Today, nothing records venue entitlement at all. bookings.venue_amount
-- and bookings.platform_fee_amount are written only when the marketplace
-- split gate is on AND the venue has an activated PayMongo Platforms
-- account — which is true for no venue, so both columns are NULL on every
-- real booking. lib/services/venueEarnings.ts says as much in its own
-- field docs: what it reports is "the requested split, not a confirmation
-- that PayMongo actually settled." So the platform currently collects all
-- money into its own account with no durable record of what it owes out.
--
-- AIR/Rally Credits sharpen this. A booking paid entirely in credit
-- collects ZERO pesos today, but the venue is still owed its 95%. The
-- cash to pay that venue comes from money collected earlier, against a
-- different booking. Entitlement and cash receipt are therefore genuinely
-- different quantities, and a ledger that conflates them will overstate
-- what the platform can afford to pay out. This table keeps them apart:
-- `venue_amount` is what is owed, `paymongo_amount` is what was actually
-- received, and `cash_position` is the difference.
--
-- NO TRANSFERS ARE IMPLEMENTED HERE. Nothing in this migration moves
-- money or calls PayMongo. The 'settled' status is reserved for a future
-- payout step and has no writer.

-- The fee rate in one place. Mirrors PLATFORM_FEE_PERCENT in
-- lib/booking-config.ts; each settlement row also stores the rate it was
-- created under, so changing this never rewrites history.
create or replace function public.platform_fee_percent()
returns numeric
language sql
immutable
as $$ select 0.05::numeric $$;

create table public.booking_settlements (
  id uuid primary key default gen_random_uuid(),
  -- ON DELETE CASCADE is safe rather than lax: bookings has no DELETE
  -- policy for any client role, so a booking is never deleted by the
  -- application — only cancelled. The cascade exists so test teardown and
  -- any future hard purge cannot leave orphaned ledger rows behind.
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete restrict,
  currency text not null default 'PHP',

  -- The booking's full price. The customer's obligation, before any
  -- question of how it was funded.
  gross_booking_amount integer not null check (gross_booking_amount > 0),
  -- Cash actually collected through PayMongo for this booking.
  paymongo_amount integer not null check (paymongo_amount >= 0),
  -- Value settled from the customer's AIR/Rally Credits wallet. Real
  -- entitlement for the venue, but NOT cash received by the platform now.
  credit_amount integer not null check (credit_amount >= 0),

  platform_fee integer not null check (platform_fee >= 0),
  venue_amount integer not null check (venue_amount >= 0),
  -- The rate this row was computed under, so a later rate change leaves
  -- historical settlements arithmetically intact.
  fee_percent_applied numeric(6, 4) not null,

  settlement_source text not null check (settlement_source in ('paymongo', 'credit', 'mixed')),
  settlement_status text not null default 'pending'
    check (settlement_status in ('pending', 'payable', 'settled', 'reversed', 'on_hold')),

  -- What the platform is up or down in CASH on this one booking. Negative
  -- means the venue is owed more than PayMongo collected — the shortfall
  -- is funded from credit issued earlier. Summing this across unsettled
  -- rows is the number to look at before enabling any payout run.
  cash_position integer generated always as (paymongo_amount - venue_amount) stored,

  payable_at timestamptz,
  settled_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The two arithmetic identities that make this a ledger rather than a
  -- log. Enforced by the database, so no code path — present or future —
  -- can write a row that doesn't balance.
  constraint settlement_funding_balances
    check (paymongo_amount + credit_amount = gross_booking_amount),
  constraint settlement_split_balances
    check (platform_fee + venue_amount = gross_booking_amount),
  -- settlement_source is derived, never independently asserted, so it can
  -- never drift from the amounts it describes.
  constraint settlement_source_matches_amounts check (
    (settlement_source = 'paymongo' and credit_amount = 0 and paymongo_amount > 0)
    or (settlement_source = 'credit' and paymongo_amount = 0 and credit_amount > 0)
    or (settlement_source = 'mixed' and paymongo_amount > 0 and credit_amount > 0)
  ),
  -- A reversed row must say when, and a settled row must say when.
  constraint settlement_reversal_timestamped
    check ((settlement_status = 'reversed') = (reversed_at is not null)),
  constraint settlement_settled_timestamped
    check ((settlement_status = 'settled') = (settled_at is not null))
);

create index booking_settlements_venue_id_idx on public.booking_settlements (venue_id);
create index booking_settlements_status_idx on public.booking_settlements (settlement_status);
-- Supports "what is owed to this venue right now" without scanning.
create index booking_settlements_venue_status_idx on public.booking_settlements (venue_id, settlement_status);

comment on table public.booking_settlements is
  'Venue entitlement per booking, independent of payment source. One row per booking, created when the booking is confirmed. No payout logic — see the 2026-08 settlement ledger design notes.';
comment on column public.booking_settlements.cash_position is
  'paymongo_amount - venue_amount. Negative means this booking owes the venue more cash than it brought in (credit-funded).';

-- === Creation ============================================================
--
-- Fires when a booking becomes confirmed, by any path: the PayMongo
-- webhook, the credit-only confirmation, or a reschedule completion. That
-- is deliberate — settlement follows the booking's own confirmed state
-- rather than being remembered separately by each checkout path, so a new
-- payment route cannot forget to produce a settlement row.
--
-- Recompute-from-source, never incremental: every amount is derived from
-- the booking's own columns at confirmation time.
create or replace function public.create_booking_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue_id uuid;
  v_gross integer;
  v_credit integer;
  v_paymongo integer;
  v_fee_percent numeric;
  v_platform_fee integer;
  v_source text;
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then
    return new;
  end if;

  -- A zero-price booking never went through checkout and has nothing to
  -- settle. Guarded here because the source CHECK requires one side of
  -- the funding split to be positive.
  if new.price_amount <= 0 then
    return new;
  end if;

  select c.venue_id into v_venue_id from public.courts c where c.id = new.court_id;
  if v_venue_id is null then
    return new;
  end if;

  v_gross := new.price_amount;
  v_credit := coalesce(new.credit_amount_applied, 0);
  v_paymongo := v_gross - v_credit;
  v_fee_percent := public.platform_fee_percent();

  -- Same integer discipline as calculateMarketplaceSplit() in
  -- lib/services/commission.ts: round the fee once, take the venue's
  -- share as the remainder by subtraction. The two therefore sum to gross
  -- exactly, for every input, as a property of the arithmetic.
  v_platform_fee := round(v_gross * v_fee_percent);

  v_source := case
    when v_credit = 0 then 'paymongo'
    when v_paymongo = 0 then 'credit'
    else 'mixed'
  end;

  insert into public.booking_settlements (
    booking_id, venue_id, currency,
    gross_booking_amount, paymongo_amount, credit_amount,
    platform_fee, venue_amount, fee_percent_applied,
    settlement_source, settlement_status
  )
  values (
    new.id, v_venue_id, new.currency,
    v_gross, v_paymongo, v_credit,
    v_platform_fee, v_gross - v_platform_fee, v_fee_percent,
    v_source, 'pending'
  )
  on conflict (booking_id) do nothing;

  return new;
end;
$$;

create trigger bookings_create_settlement
after update on public.bookings
for each row execute function public.create_booking_settlement();

-- === Reversal ============================================================
--
-- A cancelled booking's entitlement is withdrawn, never deleted — the row
-- stays as evidence that it existed and was reversed.
--
-- Deliberately NOT partial: with QR Ph, refunds cannot be executed through
-- PayMongo's API at all (see REFUND_UNSUPPORTED_SOURCE_TYPES in
-- lib/services/refunds.ts), so every customer-side remedy today is either
-- AIR/Rally Credits or a manual transfer. Modelling partial venue
-- clawbacks before either exists would be inventing rules nothing can yet
-- enforce.
--
-- An already-settled row is left alone: the money has left, and clawing it
-- back is a decision for whoever builds payouts, not something to do
-- silently here. It moves to 'on_hold' instead, which is the queue for
-- human review.
create or replace function public.reverse_booking_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  update public.booking_settlements
  set settlement_status = case when settlement_status = 'settled' then 'on_hold' else 'reversed' end,
      reversed_at = case when settlement_status = 'settled' then reversed_at else now() end,
      reversal_reason = case
        when settlement_status = 'settled'
          then 'Booking cancelled after settlement had already been paid out — needs manual review.'
        else 'Booking cancelled.'
      end,
      updated_at = now()
  where booking_id = new.id
    and settlement_status in ('pending', 'payable', 'settled');

  return new;
end;
$$;

create trigger bookings_reverse_settlement
after update on public.bookings
for each row execute function public.reverse_booking_settlement();

-- === Becoming payable ====================================================
--
-- Entitlement is earned when the court time has actually been delivered,
-- not when the customer paid. A booking confirmed three weeks out is a
-- liability the whole time; it becomes payable only after it has been
-- played.
--
-- A trigger cannot fire on the passage of time, so this is a sweep meant
-- to be called on a schedule. Idempotent by its WHERE clause — running it
-- twice, or every minute, changes nothing extra.
create or replace function public.mark_settlements_payable()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.booking_settlements s
  set settlement_status = 'payable',
      payable_at = now(),
      updated_at = now()
  from public.bookings b
  where s.booking_id = b.id
    and s.settlement_status = 'pending'
    and b.status = 'confirmed'
    and b.end_time <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- === Reconciliation ======================================================
--
-- Returns one row per problem found, empty when the ledger is sound. This
-- is the query a payout run must pass before it is allowed to move money.
-- Deliberately a function rather than a doc: rules that are only written
-- down do not get checked.
create or replace function public.reconcile_settlements()
returns table (issue text, booking_id uuid, detail text)
language sql
stable
security definer
set search_path = public
as $$
  -- 1. Every confirmed, priced booking must have a settlement row.
  select 'missing_settlement'::text, b.id, 'confirmed booking has no settlement row'::text
  from public.bookings b
  left join public.booking_settlements s on s.booking_id = b.id
  where b.status = 'confirmed' and b.price_amount > 0 and s.id is null

  union all

  -- 2. A settlement's funding must still match its booking. Catches any
  --    drift between bookings.credit_amount_applied and the ledger.
  select 'funding_mismatch', b.id,
         'booking says paymongo=' || (b.price_amount - b.credit_amount_applied)::text ||
         ' credit=' || b.credit_amount_applied::text ||
         ', settlement says paymongo=' || s.paymongo_amount::text ||
         ' credit=' || s.credit_amount::text
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where s.paymongo_amount <> b.price_amount - b.credit_amount_applied
     or s.credit_amount <> b.credit_amount_applied
     or s.gross_booking_amount <> b.price_amount

  union all

  -- 3. A cancelled booking must not carry live entitlement.
  select 'live_settlement_on_cancelled_booking', b.id,
         'booking cancelled but settlement is ' || s.settlement_status
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where b.status = 'cancelled' and s.settlement_status in ('pending', 'payable')

  union all

  -- 4. Credit-funded entitlement with no cash behind it. Not an error —
  --    it is the expected shape of a credit booking — but it must be
  --    visible, because it is the platform's own cash exposure.
  select 'unfunded_entitlement', b.id,
         'venue owed ' || s.venue_amount::text || ' but only ' || s.paymongo_amount::text || ' collected'
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where s.settlement_status in ('pending', 'payable') and s.cash_position < 0;
$$;

-- === RLS =================================================================
alter table public.booking_settlements enable row level security;

-- Venue owners see their own venue's entitlement. Read-only: this is a
-- statement of what they are owed, not something they can assert.
create policy "Venue owners read their own settlements"
on public.booking_settlements for select
using (
  exists (
    select 1 from public.venues v
    where v.id = booking_settlements.venue_id and v.owner_id = auth.uid()
  )
  or public.is_admin()
);

-- No INSERT / UPDATE / DELETE policy for any client role, including
-- admins. Every row is written by the triggers and functions above, the
-- same posture credit_transactions takes: a compromised session — of any
-- role — cannot invent, revalue, or retire an entitlement.

-- === Backfill ============================================================
-- Existing confirmed bookings get their settlement now, computed under the
-- current rate, so the ledger is complete from the moment it exists rather
-- than only covering bookings made after it.
insert into public.booking_settlements (
  booking_id, venue_id, currency,
  gross_booking_amount, paymongo_amount, credit_amount,
  platform_fee, venue_amount, fee_percent_applied,
  settlement_source, settlement_status,
  notes
)
select
  b.id,
  c.venue_id,
  b.currency,
  b.price_amount,
  b.price_amount - coalesce(b.credit_amount_applied, 0),
  coalesce(b.credit_amount_applied, 0),
  round(b.price_amount * public.platform_fee_percent()),
  b.price_amount - round(b.price_amount * public.platform_fee_percent()),
  public.platform_fee_percent(),
  case
    when coalesce(b.credit_amount_applied, 0) = 0 then 'paymongo'
    when b.price_amount - coalesce(b.credit_amount_applied, 0) = 0 then 'credit'
    else 'mixed'
  end,
  'pending',
  'Backfilled when the settlement ledger was introduced.'
from public.bookings b
join public.courts c on c.id = b.court_id
where b.status = 'confirmed' and b.price_amount > 0
on conflict (booking_id) do nothing;
