-- P0 role-gating: closes the "any authenticated player can create a
-- venue" gap identified in the role/permission architecture audit.
-- Purely additive/tightening — no existing column dropped, no existing
-- table altered in shape. Two real changes:
--
--   1. venues' INSERT policy now also requires role in
--      ('venue_owner', 'admin') — previously it only checked
--      owner_id = auth.uid(), meaning a brand-new 'player' signup could
--      insert a venue directly.
--   2. A new request_venue_owner_role() RPC — the one narrow, safe,
--      self-service 'player' -> 'venue_owner' transition, explicitly
--      never reachable to 'admin' and never able to touch another
--      user's row.
--
-- NOTE ON SCOPE: the role/permission audit that motivated this migration
-- also flagged "owner-scoped booking RLS" as missing. Re-reading
-- 20260810000004_bookings.sql's own "Users can view their own bookings"
-- policy while writing this migration found that clause already exists
-- (the exists(...courts join venues where v.owner_id = auth.uid()...)
-- branch) — that part of the audit was simply wrong, caught before
-- shipping a redundant duplicate policy. Flagged here rather than
-- silently corrected, since the audit's written findings said otherwise.
--
-- courts' own INSERT/UPDATE/DELETE policies (in
-- 20260809000003_courts.sql) already require the caller to own the
-- parent venue via v.owner_id = auth.uid() — untouched here. Since venue
-- creation is now role-gated, court creation is correctly protected
-- transitively (you cannot own a venue to attach courts to without
-- already being venue_owner/admin).

-- 1. Tighten venues' INSERT policy ------------------------------------
drop policy "Owners can create their own venues" on public.venues;

create policy "Owners can create their own venues"
on public.venues for insert
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('venue_owner', 'admin')
  )
);

-- 2. request_venue_owner_role() ----------------------------------------
--
-- prevent_role_self_escalation() (20260809000001_profiles.sql) reverts
-- ANY role change a user makes to their own profiles row, unconditionally
-- — including this RPC's own update, since SECURITY DEFINER does not
-- change auth.uid() (it still reflects the calling request's JWT, not
-- the function owner). Widened here with a transaction-local bypass GUC,
-- the same pattern already used throughout this schema
-- (air_rally.bypass_booking_tampering, air_rally.bypass_reschedule_
-- tampering, etc.) — set ONLY by this one function, for this one
-- transaction, and unset again the instant the transaction ends. No
-- other code path anywhere sets it, so every other self-escalation case
-- (a player trying to set role='admin' directly, a venue_owner trying to
-- set role='admin', anyone trying to change someone ELSE's role without
-- being admin — already blocked by RLS's own `auth.uid() = id or
-- is_admin()` check regardless of this trigger) remains exactly as
-- blocked as before this migration.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id
     and new.role is distinct from old.role
     and coalesce(current_setting('air_rally.bypass_role_self_escalation', true), 'false') <> 'true' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

-- The real security boundary is this function's own body, not the
-- bypass mechanism above: it hardcodes the target role ('venue_owner'),
-- hardcodes the required starting role ('player'), and only ever
-- updates the CALLING user's own row (id = auth.uid(), never a
-- parameter). Even though the bypass flag technically permits any role
-- value through the trigger once set, this function is the only place
-- that ever sets the flag, and it never writes anything but
-- 'venue_owner', never starting from anything but 'player'. Idempotent:
-- calling it again once already venue_owner (or admin) is a safe no-op
-- (returns false), never downgrades, never reachable to promote to
-- admin under any input.
create or replace function public.request_venue_owner_role()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  perform set_config('air_rally.bypass_role_self_escalation', 'true', true);

  update public.profiles
  set role = 'venue_owner'
  where id = auth.uid() and role = 'player'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke all on function public.request_venue_owner_role() from public, anon;
grant execute on function public.request_venue_owner_role() to authenticated;

-- RLS impact: the venues INSERT tightening is a pure narrowing (fewer
-- rows can ever be inserted, none of the existing SELECT/UPDATE/DELETE
-- policies change). The trigger widening is scoped to a bypass flag only
-- this migration's own new RPC ever sets. No existing policy anywhere
-- else in this schema is touched.
--
-- Idempotency impact: request_venue_owner_role()'s own
-- `where id = auth.uid() and role = 'player'` is the guard — a second
-- call finds zero matching rows and returns false, never errors, never
-- double-applies.
