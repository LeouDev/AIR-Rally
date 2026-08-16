-- Payout batches: an internal preparation record for grouping payable
-- settlements before any money moves.
--
-- NOTHING HERE MOVES MONEY. No PayMongo call, no transfer, no payout. A
-- batch is a plan, and approving one is a statement of intent by an admin —
-- not an instruction to a payment provider.
--
-- The single most important property of this migration: NOTHING IN IT EVER
-- WRITES settlement_status = 'settled'. Approving a batch leaves every
-- settlement exactly as it was, still 'payable'. 'settled' means "the venue
-- has actually been paid", and until a real transfer exists, claiming it
-- would make the ledger lie. The status transition guard below actively
-- refuses to move a batch into 'processing' or 'completed' for the same
-- reason: those states assert that execution happened, and no executor
-- exists.

-- Human-readable batch numbering. A sequence rather than a count(*) so two
-- admins creating batches at once cannot collide on a reference.
create sequence public.payout_batch_reference_seq;

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  batch_reference text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'reviewing', 'approved', 'processing', 'completed', 'failed', 'cancelled')),
  -- Both derived from the batch's items by trigger, never set by a caller.
  total_amount integer not null default 0 check (total_amount >= 0),
  settlement_count integer not null default 0 check (settlement_count >= 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint payout_batch_approval_timestamped
    check ((status in ('approved', 'processing', 'completed')) = (approved_at is not null)),
  constraint payout_batch_completion_timestamped
    check ((status = 'completed') = (completed_at is not null))
);

create index payout_batches_status_idx on public.payout_batches (status);

comment on table public.payout_batches is
  'Internal preparation record grouping payable settlements. Never moves money; approving a batch does not change any settlement_status. See SETTLEMENT-LEDGER.md.';

create table public.payout_batch_items (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references public.payout_batches (id) on delete cascade,
  settlement_id uuid not null references public.booking_settlements (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- Snapshot of what the settlement said when it entered the batch. The
  -- trigger below forces this to equal the settlement's venue_amount, so it
  -- is a record rather than an independent claim.
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),

  -- Same settlement twice in one batch would double-pay it.
  unique (payout_batch_id, settlement_id)
);

create index payout_batch_items_batch_idx on public.payout_batch_items (payout_batch_id);
create index payout_batch_items_settlement_idx on public.payout_batch_items (settlement_id);
create index payout_batch_items_venue_idx on public.payout_batch_items (venue_id);

-- === Item eligibility ====================================================
--
-- Enforced in the database, not in the admin UI, because "which settlements
-- may be paid" is a financial rule and the UI is only one caller.
--
-- A settlement may enter a batch only if it is:
--   * 'payable' — pending means the court time has not been delivered yet,
--     so the venue has not earned it; reversed/on_hold/settled are all
--     ineligible for obvious reasons
--   * not already in another LIVE batch — a settlement sitting in an
--     approved batch must not be picked up by a second one. Cancelled and
--     failed batches release their settlements back, which is what makes a
--     mistake recoverable rather than permanent.
create or replace function public.enforce_payout_batch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement public.booking_settlements%rowtype;
  v_existing_batch text;
begin
  select * into v_settlement from public.booking_settlements where id = new.settlement_id;

  if v_settlement.id is null then
    raise exception 'Settlement not found.' using errcode = 'no_data_found';
  end if;

  if v_settlement.settlement_status <> 'payable' then
    raise exception 'Only payable settlements can enter a payout batch (this one is %).', v_settlement.settlement_status
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

  -- Never trust a caller-supplied amount or venue: both come from the
  -- settlement itself, so a batch total can't be inflated by its creator.
  new.venue_id := v_settlement.venue_id;
  new.amount := v_settlement.venue_amount;

  return new;
end;
$$;

create trigger payout_batch_items_enforce
before insert on public.payout_batch_items
for each row execute function public.enforce_payout_batch_item();

-- Items may only be added while a batch is still being assembled. Once it
-- is approved, its contents are fixed — otherwise "approved ₱75,000" would
-- mean nothing.
create or replace function public.enforce_payout_batch_mutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_batch_id uuid := coalesce(new.payout_batch_id, old.payout_batch_id);
begin
  select status into v_status from public.payout_batches where id = v_batch_id;
  if v_status not in ('draft', 'reviewing') then
    raise exception 'Payout batch is % and can no longer be changed.', v_status using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payout_batch_items_mutable_insert
before insert on public.payout_batch_items
for each row execute function public.enforce_payout_batch_mutable();

create trigger payout_batch_items_mutable_delete
before delete on public.payout_batch_items
for each row execute function public.enforce_payout_batch_mutable();

-- === Totals ==============================================================
--
-- Recompute-from-source, the same convention every other denormalised count
-- in this schema uses (see the club/event count triggers): never increment
-- or decrement, so a total cannot drift from its items.
create or replace function public.recompute_payout_batch_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid := coalesce(new.payout_batch_id, old.payout_batch_id);
begin
  update public.payout_batches b
  set total_amount = coalesce((select sum(i.amount) from public.payout_batch_items i where i.payout_batch_id = b.id), 0),
      settlement_count = coalesce((select count(*) from public.payout_batch_items i where i.payout_batch_id = b.id), 0),
      updated_at = now()
  where b.id = v_batch_id;

  return coalesce(new, old);
end;
$$;

create trigger payout_batch_items_recompute
after insert or delete on public.payout_batch_items
for each row execute function public.recompute_payout_batch_totals();

-- === Status transitions ==================================================
--
-- The allowed graph:
--
--   draft ─→ reviewing ─→ approved ─→ (processing → completed | failed)
--     └────────┴──────────────┴─────→ cancelled
--
-- 'processing' and 'completed' are REFUSED outright. They assert that a
-- payout was executed, and there is no executor — no PayMongo transfer
-- call exists anywhere in this codebase. They stay in the CHECK constraint
-- because they are the real lifecycle a future phase will use; refusing
-- them here is what stops an admin, or a bug, from marking venues paid when
-- nothing was sent.
create or replace function public.enforce_payout_batch_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status in ('processing', 'completed') then
    raise exception 'Payout execution is not implemented — a batch cannot be marked %.', new.status
      using errcode = 'feature_not_supported';
  end if;

  if not (
    (old.status = 'draft' and new.status in ('reviewing', 'approved', 'cancelled'))
    or (old.status = 'reviewing' and new.status in ('draft', 'approved', 'cancelled'))
    or (old.status = 'approved' and new.status in ('cancelled', 'failed'))
  ) then
    raise exception 'Cannot move a payout batch from % to %.', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status = 'approved' then
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger payout_batches_enforce_status
before update on public.payout_batches
for each row execute function public.enforce_payout_batch_status();

-- === RLS =================================================================
alter table public.payout_batches enable row level security;
alter table public.payout_batch_items enable row level security;

-- Batches are an admin instrument end to end.
create policy "Admins read payout batches"
on public.payout_batches for select
using (public.is_admin());

create policy "Admins create payout batches"
on public.payout_batches for insert
with check (public.is_admin() and created_by = auth.uid());

create policy "Admins update payout batches"
on public.payout_batches for update
using (public.is_admin())
with check (public.is_admin());

-- No DELETE policy: a batch is cancelled, never erased. The record that a
-- payout was contemplated is itself worth keeping.

-- Items are visible to admins, and to the venue owner they concern — an
-- owner seeing "your ₱8,500 is in batch PB-000004" is the point of the
-- owner-facing status. Read-only, and scoped to their own venue, so no
-- owner learns anything about another's payouts.
create policy "Admins and the owning venue read payout batch items"
on public.payout_batch_items for select
using (
  public.is_admin()
  or exists (
    select 1 from public.venues v
    where v.id = payout_batch_items.venue_id and v.owner_id = auth.uid()
  )
);

create policy "Admins add payout batch items"
on public.payout_batch_items for insert
with check (public.is_admin());

create policy "Admins remove payout batch items"
on public.payout_batch_items for delete
using (public.is_admin());

-- === Admin operations ====================================================
--
-- Batch creation is one transaction: either every settlement is eligible
-- and the batch exists, or nothing happens. A partially-built batch with
-- some settlements silently dropped is the failure mode worth designing
-- out — an admin would approve a total that doesn't match what they picked.
--
-- SECURITY DEFINER with its own is_admin() check, following the lesson from
-- 20260810000040: a definer function's own guard is the boundary, never the
-- page that happens to call it.
create or replace function public.create_payout_batch(p_settlement_ids uuid[], p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_settlement_id uuid;
  v_reference text;
begin
  if not public.is_admin() then
    raise exception 'Creating a payout batch is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if p_settlement_ids is null or array_length(p_settlement_ids, 1) is null then
    raise exception 'A payout batch needs at least one settlement.' using errcode = 'check_violation';
  end if;

  v_reference := 'PB-' || lpad(nextval('public.payout_batch_reference_seq')::text, 6, '0');

  insert into public.payout_batches (batch_reference, status, created_by, notes)
  values (v_reference, 'draft', auth.uid(), p_notes)
  returning id into v_batch_id;

  -- Each insert runs the eligibility trigger; the first ineligible
  -- settlement aborts the whole statement and the batch with it.
  foreach v_settlement_id in array p_settlement_ids loop
    insert into public.payout_batch_items (payout_batch_id, settlement_id, venue_id, amount)
    -- venue_id/amount are overwritten from the settlement by the trigger;
    -- these placeholders only satisfy NOT NULL.
    values (v_batch_id, v_settlement_id, '00000000-0000-0000-0000-000000000000', 1);
  end loop;

  return v_batch_id;
end;
$$;

-- Approval records a decision. It does NOT pay anyone, and deliberately
-- leaves every settlement in the batch at 'payable' — they become 'settled'
-- only when a real transfer succeeds, which no code can currently do.
create or replace function public.approve_payout_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if not public.is_admin() then
    raise exception 'Approving a payout batch is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  update public.payout_batches
  set status = 'approved'
  where id = p_batch_id
    and status in ('draft', 'reviewing')
    and settlement_count > 0
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

create or replace function public.cancel_payout_batch(p_batch_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if not public.is_admin() then
    raise exception 'Cancelling a payout batch is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  update public.payout_batches
  set status = 'cancelled',
      notes = coalesce(p_reason, notes),
      updated_at = now()
  where id = p_batch_id
    and status in ('draft', 'reviewing', 'approved')
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.create_payout_batch(uuid[], text) from public, anon;
revoke all on function public.approve_payout_batch(uuid) from public, anon;
revoke all on function public.cancel_payout_batch(uuid, text) from public, anon;
grant execute on function public.create_payout_batch(uuid[], text) to authenticated, service_role;
grant execute on function public.approve_payout_batch(uuid) to authenticated, service_role;
grant execute on function public.cancel_payout_batch(uuid, text) to authenticated, service_role;

-- === Readiness ===========================================================
--
-- The cash question, answered in SQL so the dashboard and any future payout
-- run read the same numbers rather than two implementations of them.
--
-- `cash_position_total` is the one that matters: payable entitlement minus
-- the cash actually collected against it. Negative means AIR/Rally would be
-- paying out more than it took in on those bookings, funded from earlier
-- receipts. That is not automatically wrong — it is the expected shape of a
-- credits business — but it must be a decision, not a surprise.
create or replace function public.payout_cash_position()
returns table (
  available_payable_amount bigint,
  credit_funded_exposure bigint,
  cash_position_total bigint,
  on_hold_amount bigint,
  pending_amount bigint,
  batched_amount bigint
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
    coalesce(sum(s.venue_amount) filter (where s.settlement_status = 'payable'), 0)::bigint,
    coalesce(sum(-s.cash_position) filter (
      where s.settlement_status in ('pending', 'payable') and s.cash_position < 0
    ), 0)::bigint,
    coalesce(sum(s.cash_position) filter (where s.settlement_status in ('pending', 'payable')), 0)::bigint,
    coalesce(sum(s.venue_amount) filter (where s.settlement_status = 'on_hold'), 0)::bigint,
    coalesce(sum(s.venue_amount) filter (where s.settlement_status = 'pending'), 0)::bigint,
    coalesce((
      select sum(i.amount) from public.payout_batch_items i
      join public.payout_batches b on b.id = i.payout_batch_id
      where b.status not in ('cancelled', 'failed')
    ), 0)::bigint
  from public.booking_settlements s;
end;
$$;

revoke all on function public.payout_cash_position() from public, anon;
grant execute on function public.payout_cash_position() to authenticated, service_role;

-- Settlements that are payable and not already committed to a live batch —
-- the exact candidate set an admin may draw a new batch from.
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
  where s.settlement_status = 'payable'
    and not exists (
      select 1 from public.payout_batch_items i
      join public.payout_batches b on b.id = i.payout_batch_id
      where i.settlement_id = s.id and b.status not in ('cancelled', 'failed')
    )
  order by s.venue_id, s.created_at;
end;
$$;

revoke all on function public.available_settlements_for_payout() from public, anon;
grant execute on function public.available_settlements_for_payout() to authenticated, service_role;
