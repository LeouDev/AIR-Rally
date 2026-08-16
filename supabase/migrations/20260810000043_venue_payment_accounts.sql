-- Venue payout readiness: whether a venue is ready to RECEIVE money.
--
-- AUDIT FINDING — this is deliberately NOT a second copy of what venues
-- already stores. `venues` already carries paymongo_account_id and
-- paymongo_activation_status (unlinked / pending / under_review /
-- activated / declined), written by the real onboarding flow in
-- lib/services/paymongoAccounts.ts. Copying those into a new table would
-- create two answers to "can this venue be paid", which for money is the
-- worst kind of duplication.
--
-- This table earns its place by answering a DIFFERENT question:
--
--   venues.paymongo_activation_status = what PayMongo says about the
--     merchant. It governs whether a CHECKOUT can be split. AIR/Rally does
--     not own this value; PayMongo does, via webhook.
--
--   venue_payment_accounts.status = whether AIR/Rally will PAY this venue.
--     PayMongo activation is necessary but not sufficient: an admin may
--     restrict a venue during a dispute, or disable it, without anything
--     changing at PayMongo.
--
-- The PayMongo facts therefore keep a single writer. `paymongo_account_id`
-- and the baseline status are MIRRORED from venues by the trigger below,
-- never typed in by hand. The only independent thing here is the admin's
-- restrict/disable decision, which deliberately overrides the mirror.
--
-- `provider` exists so a second payout rail can be added without reshaping
-- this table. Only 'paymongo' is implemented; see lib/services/payoutProvider.ts.
--
-- NOTHING HERE MOVES MONEY.

create table public.venue_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  provider text not null default 'paymongo' check (provider in ('paymongo')),
  -- Mirrored from venues.paymongo_account_id. Never client-writable.
  paymongo_account_id text,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'pending_verification', 'verified', 'restricted', 'disabled')),
  /** Why an admin restricted or disabled this account, shown to the owner. */
  status_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One account per venue per provider.
  unique (venue_id, provider),
  constraint venue_payment_account_verified_timestamped
    check (status <> 'verified' or verified_at is not null)
);

create index venue_payment_accounts_status_idx on public.venue_payment_accounts (status);
create index venue_payment_accounts_venue_idx on public.venue_payment_accounts (venue_id);

comment on table public.venue_payment_accounts is
  'Whether AIR/Rally will pay a venue. Mirrors PayMongo facts from venues.paymongo_*; the admin restrict/disable decision is the only independently-owned state. See docs/payments/payout-readiness.md.';

-- === Mirroring ===========================================================
--
-- Maps PayMongo's own activation status onto payout readiness. Runs on
-- venue insert and whenever the PayMongo fields change, so the account row
-- exists for every venue and tracks reality without anyone maintaining it.
--
-- The one thing the mirror will NOT do is overwrite an admin's
-- restrict/disable. If AIR/Rally has decided not to pay a venue, PayMongo
-- re-activating the merchant must not silently undo that decision.
create or replace function public.sync_venue_payment_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapped text;
  v_existing text;
begin
  v_mapped := case new.paymongo_activation_status
    when 'activated' then 'verified'
    when 'pending' then 'pending_verification'
    when 'under_review' then 'pending_verification'
    when 'declined' then 'restricted'
    else 'not_connected'
  end;

  select status into v_existing
  from public.venue_payment_accounts
  where venue_id = new.id and provider = 'paymongo';

  if v_existing in ('restricted', 'disabled') and v_mapped <> 'restricted' then
    -- An admin decision outranks the mirror. Keep the account id fresh but
    -- leave the status alone.
    update public.venue_payment_accounts
    set paymongo_account_id = new.paymongo_account_id, updated_at = now()
    where venue_id = new.id and provider = 'paymongo';
    return new;
  end if;

  insert into public.venue_payment_accounts (venue_id, provider, paymongo_account_id, status, verified_at)
  values (
    new.id, 'paymongo', new.paymongo_account_id, v_mapped,
    case when v_mapped = 'verified' then coalesce(new.paymongo_activated_at, now()) else null end
  )
  on conflict (venue_id, provider) do update
  set paymongo_account_id = excluded.paymongo_account_id,
      status = excluded.status,
      -- Keep the original verification moment if it was already verified.
      verified_at = case
        when excluded.status = 'verified'
          then coalesce(public.venue_payment_accounts.verified_at, excluded.verified_at)
        else null
      end,
      updated_at = now();

  return new;
end;
$$;

create trigger venues_sync_payment_account
after insert on public.venues
for each row execute function public.sync_venue_payment_account();

create trigger venues_sync_payment_account_on_change
after update of paymongo_activation_status, paymongo_account_id on public.venues
for each row execute function public.sync_venue_payment_account();

-- === Admin control =======================================================
--
-- The only way any client changes a payout status. service-definer with its
-- own is_admin() check, following 20260810000040.
create or replace function public.set_venue_payment_account_status(
  p_venue_id uuid,
  p_status text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if not public.is_admin() then
    raise exception 'Managing venue payment accounts is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  -- 'not_connected' and 'pending_verification' describe what PayMongo
  -- reports, so they are the mirror's to set, never an admin's to assert.
  if p_status not in ('verified', 'restricted', 'disabled') then
    raise exception 'An admin may only mark an account verified, restricted, or disabled.' using errcode = 'check_violation';
  end if;

  update public.venue_payment_accounts
  set status = p_status,
      status_reason = p_reason,
      verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else verified_at end,
      updated_at = now()
  where venue_id = p_venue_id and provider = 'paymongo'
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.set_venue_payment_account_status(uuid, text, text) from public, anon;
grant execute on function public.set_venue_payment_account_status(uuid, text, text) to authenticated, service_role;

-- === RLS =================================================================
alter table public.venue_payment_accounts enable row level security;

-- An owner sees their own venue's payout readiness. Read-only: they cannot
-- declare themselves verified, and they cannot touch the account id.
create policy "Owners read their own venue payment accounts"
on public.venue_payment_accounts for select
using (
  public.is_admin()
  or exists (
    select 1 from public.venues v
    where v.id = venue_payment_accounts.venue_id and v.owner_id = auth.uid()
  )
);

-- No INSERT / UPDATE / DELETE policy for any role, including admins. Rows
-- are created by the mirror trigger and changed only through
-- set_venue_payment_account_status().

-- === Backfill ============================================================
-- Every existing venue gets its account row now, derived from whatever
-- PayMongo state it already has, so the table is complete rather than only
-- covering venues created after it.
insert into public.venue_payment_accounts (venue_id, provider, paymongo_account_id, status, verified_at)
select
  v.id, 'paymongo', v.paymongo_account_id,
  case v.paymongo_activation_status
    when 'activated' then 'verified'
    when 'pending' then 'pending_verification'
    when 'under_review' then 'pending_verification'
    when 'declined' then 'restricted'
    else 'not_connected'
  end,
  case when v.paymongo_activation_status = 'activated' then coalesce(v.paymongo_activated_at, now()) else null end
from public.venues v
on conflict (venue_id, provider) do nothing;

-- === Payout eligibility ==================================================
--
-- A settlement is payable only if the VENUE can actually receive it. Before
-- this, a batch could be assembled for a venue with nowhere to send money
-- — the batch would look correct right up to the moment a transfer was
-- attempted.
--
-- Enforced in the trigger, not just the candidate query, so it holds even
-- if a settlement id is passed in directly.
create or replace function public.enforce_payout_batch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement public.booking_settlements%rowtype;
  v_existing_batch text;
  v_account_status text;
begin
  select * into v_settlement from public.booking_settlements where id = new.settlement_id;

  if v_settlement.id is null then
    raise exception 'Settlement not found.' using errcode = 'no_data_found';
  end if;

  if v_settlement.settlement_status <> 'payable' then
    raise exception 'Only payable settlements can enter a payout batch (this one is %).', v_settlement.settlement_status
      using errcode = 'check_violation';
  end if;

  -- NEW: the venue must be able to receive the money.
  select status into v_account_status
  from public.venue_payment_accounts
  where venue_id = v_settlement.venue_id and provider = 'paymongo';

  if v_account_status is distinct from 'verified' then
    raise exception 'Venue payment account unavailable (%).', coalesce(v_account_status, 'not_connected')
      using errcode = 'check_violation';
  end if;

  select b.batch_reference into v_existing_batch
  from public.payout_batch_items i
  join public.payout_batches b on b.id = i.payout_batch_id
  where i.settlement_id = new.settlement_id
    and i.payout_batch_id is distinct from new.payout_batch_id
    and b.status not in ('cancelled', 'failed')
  limit 1;

  if v_existing_batch is not null then
    raise exception 'Settlement is already in payout batch %.', v_existing_batch using errcode = 'unique_violation';
  end if;

  new.venue_id := v_settlement.venue_id;
  new.amount := v_settlement.venue_amount;

  return new;
end;
$$;

-- Candidates now exclude venues that cannot be paid, so the admin UI never
-- offers a settlement the trigger would reject.
create or replace function public.available_settlements_for_payout()
returns setof public.booking_settlements
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Payout preparation is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select s.*
  from public.booking_settlements s
  join public.venue_payment_accounts a
    on a.venue_id = s.venue_id and a.provider = 'paymongo' and a.status = 'verified'
  where s.settlement_status = 'payable'
    and not exists (
      select 1 from public.payout_batch_items i
      join public.payout_batches b on b.id = i.payout_batch_id
      where i.settlement_id = s.id and b.status not in ('cancelled', 'failed')
    )
  order by s.venue_id, s.created_at;
end;
$$;

-- === Readiness reporting =================================================
--
-- How much earned money is stuck because a venue cannot receive it. This is
-- an operational number, not an error: it tells an admin exactly how much
-- is unlocked by chasing venue onboarding.
create or replace function public.venue_payout_readiness()
returns table (
  venues_ready bigint,
  venues_missing_setup bigint,
  venues_restricted bigint,
  blocked_settlement_amount bigint,
  blocked_settlement_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Payout readiness is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*) from public.venue_payment_accounts where status = 'verified')::bigint,
    (select count(*) from public.venue_payment_accounts where status in ('not_connected', 'pending_verification'))::bigint,
    (select count(*) from public.venue_payment_accounts where status in ('restricted', 'disabled'))::bigint,
    coalesce((
      select sum(s.venue_amount)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable' and coalesce(a.status, 'not_connected') <> 'verified'
    ), 0)::bigint,
    coalesce((
      select count(*)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable' and coalesce(a.status, 'not_connected') <> 'verified'
    ), 0)::bigint;
end;
$$;

revoke all on function public.venue_payout_readiness() from public, anon;
grant execute on function public.venue_payout_readiness() to authenticated, service_role;
