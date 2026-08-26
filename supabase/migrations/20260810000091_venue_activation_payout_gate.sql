-- A venue cannot go live without somewhere to send its earnings.
--
-- THIS IS NOT NEW POLICY. The Venue Owner Agreement already says it, in
-- section 2.2: "Before your venue can accept bookings, seven things must be
-- complete: business information; address; at least one active court; a
-- price above ₱0 on every active court; at least one operating-hours
-- window; our approval; and your payout bank details."
--
-- The code has never enforced any of it. setVenueStatusAsAdmin() is a plain
-- unconditional UPDATE, so an admin can activate a venue that fails every
-- item on that list, including the payout one. The current state is the
-- exposure; this migration closes the gap between a document owners sign
-- and what the software actually does.
--
-- WHAT IS ENFORCED HERE, AND WHAT DELIBERATELY IS NOT
--
-- Only the payout destination is blocked at the database. The other six
-- readiness items stay advisory, computed by src/lib/services/venueReadiness.ts
-- and shown to the admin as warnings they may override with a reason.
--
-- That split is deliberate, not an oversight, and the reason is worth
-- stating so nobody later "completes" it: the remaining items are
-- business-judgement calls an admin may rationally override (a venue with
-- no photos yet, hours still being set), and blocking those turns a useful
-- checklist into an obstacle that gets routed around. The payout
-- destination has no legitimate override — there is no reason to activate a
-- venue you cannot pay.
--
-- The database also CANNOT compute the other six. venueReadiness.ts reads
-- courts, pricing, operating hours and photos in TypeScript; reimplementing
-- that in SQL would create a second definition of "ready" that drifts from
-- the first, which is precisely the failure this project has been cleaning
-- up all week. One rule needs a guarantee, so one rule lives here.

-- === The shared predicate ==================================================
--
-- "Does this venue have somewhere to receive money" was answered in six
-- separate places across 20260810000089 and 20260810000090, and this
-- migration would have made it seven. Each copy is individually trivial,
-- which is exactly what makes divergence easy to miss: a future change to
-- one of them leaves the others silently disagreeing about who can be paid.
--
-- Testing bank_name alone is sufficient, and that is a property of the
-- schema rather than a shortcut: venue_bank_details_all_or_nothing
-- (20260810000053) makes the three bank columns all-null or all-present, so
-- one non-null implies all three.
create or replace function public.venue_has_payout_destination(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.venue_payment_accounts
    where venue_id = p_venue_id
      and provider = 'paymongo'
      and bank_name is not null
  );
$$;

comment on function public.venue_has_payout_destination(uuid) is
  'Single definition of "this venue has a payout destination on file". Every payout-path '
  'gate calls this rather than re-testing bank_name, so the rule cannot drift between them. '
  'SECURITY DEFINER so it reads venue_payment_accounts consistently regardless of caller.';

revoke all on function public.venue_has_payout_destination(uuid) from public, anon;
grant execute on function public.venue_has_payout_destination(uuid) to authenticated, service_role;

-- === Repoint the existing gates at it ======================================
--
-- Same behaviour, one definition. Rewritten from the CURRENT live bodies
-- (089's versions), not from an earlier migration's text.
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

  select status into v_account_status
  from public.venue_payment_accounts
  where venue_id = v_settlement.venue_id and provider = 'paymongo';

  if v_account_status is distinct from 'verified' then
    raise exception 'Venue payment account unavailable (%).', coalesce(v_account_status, 'not_connected')
      using errcode = 'check_violation';
  end if;

  if not public.venue_has_payout_destination(v_settlement.venue_id) then
    raise exception 'Venue has no bank details on file — nowhere to send this payout.'
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
    and public.venue_has_payout_destination(s.venue_id)
    and not exists (
      select 1 from public.payout_batch_items i
      join public.payout_batches b on b.id = i.payout_batch_id
      where i.settlement_id = s.id and b.status not in ('cancelled', 'failed')
    )
  order by s.venue_id, s.created_at;
end;
$$;

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
    (select count(*) from public.venue_payment_accounts
       where status = 'verified' and public.venue_has_payout_destination(venue_id))::bigint,
    (select count(*) from public.venue_payment_accounts
       where status in ('not_connected', 'pending_verification')
          or (status = 'verified' and not public.venue_has_payout_destination(venue_id)))::bigint,
    (select count(*) from public.venue_payment_accounts where status in ('restricted', 'disabled'))::bigint,
    coalesce((
      select sum(s.venue_amount)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable'
        and (coalesce(a.status, 'not_connected') <> 'verified' or not public.venue_has_payout_destination(s.venue_id))
    ), 0)::bigint,
    coalesce((
      select count(*)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable'
        and (coalesce(a.status, 'not_connected') <> 'verified' or not public.venue_has_payout_destination(s.venue_id))
    ), 0)::bigint;
end;
$$;

-- === The override record ===================================================
--
-- A TABLE rather than columns on `venues`, and the reason is the same one
-- that justifies recording this at all.
--
-- venueReadiness is computed LIVE from current state, so "what was
-- incomplete when this venue went live" is destroyed by time — the venue
-- adds photos and the past becomes unrecoverable. That is what makes the
-- record worth keeping. But venue activation is explicitly RECURRING
-- (activate -> suspend -> reactivate), so columns would be overwritten by
-- the next activation and would forget exactly what they exist to remember.
-- An audit record that forgets is a weaker instance of the problem it was
-- built to solve.
--
-- This is why the resolution_note precedent (reports, support_requests)
-- does NOT transfer: those sit on terminal, once-only states. The closer
-- analogue is adjust_user_credits(), which requires a reason and writes to
-- a ledger for this same reason.
create table public.venue_activation_overrides (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  activated_by uuid not null references public.profiles (id) on delete restrict,
  activated_at timestamptz not null default now(),
  /** Why the admin activated despite outstanding warnings. Required, non-empty. */
  override_reason text not null check (char_length(btrim(override_reason)) between 1 and 1000),
  /**
   * Snapshot of the readiness items that were incomplete at activation.
   *
   * THE LOAD-BEARING FIELD: the reason is what the admin typed, this is the
   * thing that is otherwise unrecoverable.
   *
   * HONEST LIMITATION — this is supplied by the caller, not computed here.
   * The database cannot evaluate venueReadiness (see the header), so a
   * caller could pass an empty array and understate what was outstanding.
   * The blast radius is "this audit record is less accurate than it should
   * be", NOT "an unpayable venue went live": the payout block below is
   * enforced independently and ignores this field entirely. Treat it as the
   * admin's declaration, not as an authoritative computation.
   */
  outstanding_warnings jsonb not null default '[]'::jsonb
);

create index venue_activation_overrides_venue_idx on public.venue_activation_overrides (venue_id, activated_at desc);

comment on table public.venue_activation_overrides is
  'Append-only record of a venue activated while readiness warnings were outstanding. A table '
  'rather than columns because activation recurs and columns would overwrite the history they exist to keep.';

alter table public.venue_activation_overrides enable row level security;

-- Admin-read only. Not owner-visible: this records an internal decision
-- about their venue, and there is no INSERT/UPDATE/DELETE policy for any
-- role — rows are written solely by set_venue_active() below.
create policy "Admins read venue activation overrides"
on public.venue_activation_overrides for select
using (public.is_admin());

-- === The hard block ========================================================
--
-- On the table, not in the service function. A guard living only in
-- setVenueStatusAsAdmin() holds for exactly the path it patches — a direct
-- UPDATE, a future admin tool, a backfill, or code nobody has written yet
-- all sail past it. The app-layer check is the good error message; this is
-- the guarantee.
--
-- Fires only on the TRANSITION into 'active' (and on inserting one
-- directly), so ordinary edits to an already-active venue are untouched.
--
-- Venues already 'active' without a payout destination are NOT retroactively
-- suspended — production has two such venues today. They keep running; they
-- simply cannot be re-activated after a suspension until their details are
-- on file, and 20260810000089 already stops their earnings entering a batch.
create or replace function public.enforce_venue_activation_payout_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not public.venue_has_payout_destination(new.id) then
    raise exception 'Venue cannot go live without payout bank details on file.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger venues_enforce_activation_payout_destination
before insert or update on public.venues
for each row execute function public.enforce_venue_activation_payout_destination();

-- === The admin entry point =================================================
--
-- SECURITY DEFINER with its own is_admin() check, following 20260810000040:
-- a definer function's own guard is the boundary, never the page that calls
-- it.
--
-- The payout block is NOT overridable here. p_override_reason covers the
-- advisory readiness items only; passing a reason does not and cannot
-- unlock a venue with no payout destination, because the trigger above runs
-- regardless of how the UPDATE was issued.
create or replace function public.set_venue_active(
  p_venue_id uuid,
  p_override_reason text default null,
  p_outstanding_warnings jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_warnings boolean := coalesce(jsonb_array_length(p_outstanding_warnings), 0) > 0;
  v_updated uuid;
begin
  if not public.is_admin() then
    raise exception 'Activating a venue is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  -- Checked before the update purely to produce a clearer message than the
  -- trigger's; the trigger is what actually guarantees it.
  if not public.venue_has_payout_destination(p_venue_id) then
    raise exception 'Venue cannot go live without payout bank details on file.'
      using errcode = 'check_violation';
  end if;

  if v_has_warnings and (p_override_reason is null or btrim(p_override_reason) = '') then
    raise exception 'A reason is required to activate a venue with outstanding readiness warnings.'
      using errcode = 'check_violation';
  end if;

  update public.venues set status = 'active' where id = p_venue_id returning id into v_updated;
  if v_updated is null then
    raise exception 'Venue not found.' using errcode = 'no_data_found';
  end if;

  -- Recorded only when something was actually overridden. A clean
  -- activation is not an override and should not read as one.
  if v_has_warnings then
    insert into public.venue_activation_overrides (venue_id, activated_by, override_reason, outstanding_warnings)
    values (p_venue_id, auth.uid(), btrim(p_override_reason), p_outstanding_warnings);
  end if;

  return true;
end;
$$;

revoke all on function public.set_venue_active(uuid, text, jsonb) from public, anon;
grant execute on function public.set_venue_active(uuid, text, jsonb) to authenticated, service_role;
