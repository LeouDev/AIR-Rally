create table public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  description text,
  surface_type text,
  indoor_outdoor text not null default 'outdoor' check (indoor_outdoor in ('indoor', 'outdoor')),
  capacity integer check (capacity > 0),
  hourly_price numeric(10, 2) not null default 0 check (hourly_price >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index courts_venue_id_idx on public.courts (venue_id);
create index courts_status_idx on public.courts (status);

create trigger courts_set_updated_at
before update on public.courts
for each row execute function public.set_updated_at();

alter table public.courts enable row level security;

-- A court is publicly visible only when both it and its parent venue are
-- in a public-facing state.
create policy "Public can view active courts at active venues"
on public.courts for select
using (
  (
    status = 'active'
    and exists (select 1 from public.venues v where v.id = courts.venue_id and v.status = 'active')
  )
  or exists (select 1 from public.venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);

create policy "Venue owners can add courts to their venues"
on public.courts for insert
with check (
  exists (select 1 from public.venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
);

create policy "Venue owners can update courts at their venues"
on public.courts for update
using (
  exists (select 1 from public.venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
)
with check (
  exists (select 1 from public.venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);

create policy "Venue owners can delete courts at their venues"
on public.courts for delete
using (
  exists (select 1 from public.venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);
