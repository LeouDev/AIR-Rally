create table public.venues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  address text,
  city text,
  state_province text,
  country text,
  latitude double precision,
  longitude double precision,
  phone text,
  email text,
  website text,
  indoor_outdoor text not null default 'outdoor' check (indoor_outdoor in ('indoor', 'outdoor', 'both')),
  number_of_courts integer not null default 1 check (number_of_courts >= 0),
  -- Denormalized rating cache, kept in sync by a trigger on `reviews`
  -- (see the reviews migration) — avoids an AVG()/COUNT() over reviews on
  -- every venue list render, which is the one piece of "derived data" here
  -- that's worth caching.
  average_rating numeric(3, 2) not null default 0,
  review_count integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venues_owner_id_idx on public.venues (owner_id);
create index venues_status_idx on public.venues (status);
create index venues_city_idx on public.venues (city);

create trigger venues_set_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

-- Owners can freely edit their own venue at any status, but can't be the
-- one who flips it to 'active' or 'suspended' — that's a platform decision.
-- Enforced as a trigger (comparing OLD vs NEW) rather than a WITH CHECK
-- clause so it doesn't also block ordinary edits to an already-active venue.
create or replace function public.prevent_owner_status_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin()
     and new.status is distinct from old.status
     and new.status not in ('draft', 'pending_review') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger venues_prevent_status_escalation
before update on public.venues
for each row execute function public.prevent_owner_status_escalation();

alter table public.venues enable row level security;

create policy "Public can view active venues"
on public.venues for select
using (status = 'active' or owner_id = auth.uid() or public.is_admin());

create policy "Owners can create their own venues"
on public.venues for insert
with check (owner_id = auth.uid());

-- Status escalation (draft/pending_review -> active/suspended) is blocked
-- by the venues_prevent_status_escalation trigger above, not here — see
-- its comment for why that has to be a trigger rather than a WITH CHECK.
create policy "Owners can update their own venues"
on public.venues for update
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "Owners can delete their own draft venues"
on public.venues for delete
using ((owner_id = auth.uid() and status = 'draft') or public.is_admin());
