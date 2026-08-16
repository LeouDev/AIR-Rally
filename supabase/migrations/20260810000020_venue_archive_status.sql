-- Adds a genuine 'archived' status, distinct from 'suspended' (an
-- admin-only, punitive/policy state) — this one an owner can self-select
-- for a venue that's no longer operating, without needing admin action.
-- Deliberately not reusing 'draft' for this: a freshly-created,
-- never-launched venue and a formerly-active venue winding down are
-- different things, and collapsing them would make it impossible to
-- later tell which "draft" venues used to be live.
--
-- Reactivating an archived venue routes back through 'pending_review'
-- (already an unconditional self-service transition per the existing
-- trigger below), not directly to 'active' — going live still requires
-- the same admin decision as any other venue, archived or brand new.
alter table public.venues drop constraint venues_status_check;
alter table public.venues add constraint venues_status_check
  check (status in ('draft', 'pending_review', 'active', 'suspended', 'archived'));

create or replace function public.prevent_owner_status_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin()
     and new.status is distinct from old.status
     and new.status not in ('draft', 'pending_review', 'archived') then
    new.status := old.status;
  end if;
  return new;
end;
$$;
