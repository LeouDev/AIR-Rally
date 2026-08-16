-- Phase 6, Part 3: the account-level owner-approval gatekeeper. Additive
-- only — no existing table/column/policy is touched or dropped.
--
-- CONTEXT: venues' own INSERT policy (20260810000016_role_gating.sql)
-- already requires `role in ('venue_owner', 'admin')` — that part of the
-- gate is correct today. The actual bug lives entirely in application
-- code: createVenueDraftAction() calls request_venue_owner_role() on
-- every venue-create attempt, silently self-promoting any 'player' in
-- the same request, with zero human review. This migration (a) adds the
-- real account-level approval state, (b) revokes the RPC that made the
-- silent auto-promotion possible, and (c) adds the table an admin
-- reviews before ever granting 'venue_owner'. The application-side fix
-- (deleting the RPC call) ships alongside this migration.

alter table public.profiles
  add column owner_status text not null default 'none'
  check (owner_status in ('none', 'pending', 'approved', 'rejected'));

create index profiles_owner_status_idx on public.profiles (owner_status);

-- Same shape as venues' own prevent_owner_status_escalation() (see
-- 20260809000002_venues.sql / 20260810000020_venue_archive_status.sql):
-- `not is_admin()` alone is sufficient to detect "this is a self-service
-- update," because profiles' own UPDATE RLS (`auth.uid() = id or
-- is_admin()`) already guarantees that any non-admin reaching this
-- trigger is updating their OWN row. The one self-service transition
-- allowed is 'none'|'rejected' -> 'pending' ("request owner access," see
-- requestOwnerAccessAction) — a rejected applicant may re-apply. Every
-- other transition (in particular, anything landing on 'approved') is
-- admin-only, silently reverted otherwise.
create or replace function public.prevent_owner_status_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin()
     and new.owner_status is distinct from old.owner_status
     and not (old.owner_status in ('none', 'rejected') and new.owner_status = 'pending') then
    new.owner_status := old.owner_status;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_owner_status_tampering
before update on public.profiles
for each row execute function public.prevent_owner_status_tampering();

-- Closes the actual loophole. The function stays defined (harmless,
-- unreachable) rather than dropped, matching this codebase's
-- additive-only convention — nothing calls it once
-- createVenueDraftAction stops. Player -> venue_owner now happens
-- exclusively via an admin approving an owner_applications row (a plain
-- UPDATE on a DIFFERENT user's row, which profiles_prevent_role_change
-- never blocks in the first place — see that trigger's own `auth.uid()
-- = new.id` guard).
revoke execute on function public.request_venue_owner_role() from authenticated;

-- The lightweight application an admin actually reviews. Deliberately
-- NOT a full venue draft — a real venues/courts row can't exist yet (the
-- applicant isn't 'venue_owner' until approved, and courts/court_images/
-- venue_operating_hours all FK to venue_id) — this just captures enough
-- for a human decision. Once approved, the real venue/courts/photos/
-- hours are created through the existing, already-built /list-your-court
-- owner dashboard, not duplicated here.
create table public.owner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_name text not null,
  business_phone text not null,
  business_email text not null,
  venue_name text not null,
  venue_address text not null,
  venue_city text not null,
  venue_description text,
  court_count integer not null check (court_count > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index owner_applications_user_id_idx on public.owner_applications (user_id);
create index owner_applications_status_idx on public.owner_applications (status);

create trigger owner_applications_set_updated_at
before update on public.owner_applications
for each row execute function public.set_updated_at();

alter table public.owner_applications enable row level security;

create policy "Applicants can view their own application, admins see all"
on public.owner_applications for select
using (user_id = auth.uid() or public.is_admin());

-- Pins a self-service insert to the true starting state — a client can't
-- fabricate an already-approved application, same posture as
-- booking_reschedules' own "insert pins to pending_payment" policy.
create policy "Users can submit their own application"
on public.owner_applications for insert
with check (user_id = auth.uid() and status = 'pending');

-- Admin-only update — the only transitions this table ever needs
-- (pending -> approved/rejected) are exclusively admin decisions; there
-- is no self-service edit-after-submit in this phase.
create policy "Admins can review applications"
on public.owner_applications for update
using (public.is_admin())
with check (public.is_admin());
