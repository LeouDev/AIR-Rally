create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- lucide-react icon name, mirroring the pattern used by the Phase 1 mock
  -- amenities in src/lib/mock-data/amenities.ts
  icon text,
  created_at timestamptz not null default now()
);

alter table public.amenities enable row level security;

create policy "Amenities are publicly readable"
on public.amenities for select
using (true);

create policy "Only admins manage the amenities list"
on public.amenities for all
using (public.is_admin())
with check (public.is_admin());

insert into public.amenities (name, icon) values
  ('Night Lighting', 'Lightbulb'),
  ('Restrooms', 'DoorOpen'),
  ('Free Parking', 'SquareParking'),
  ('Pro Shop', 'ShoppingBag'),
  ('Water Station', 'GlassWater'),
  ('Showers', 'ShowerHead'),
  ('Spectator Seating', 'Armchair'),
  ('Paddle Rental', 'Volleyball'),
  ('Air Conditioned', 'Fan'),
  ('On-site Café', 'Coffee'),
  ('Lockers', 'Lock'),
  ('Wheelchair Accessible', 'Accessibility'),
  ('Wi-Fi', 'Wifi');

-- venue_amenities (many-to-many) -------------------------------------------

create table public.venue_amenities (
  venue_id uuid not null references public.venues (id) on delete cascade,
  amenity_id uuid not null references public.amenities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, amenity_id)
);

create index venue_amenities_amenity_id_idx on public.venue_amenities (amenity_id);

alter table public.venue_amenities enable row level security;

create policy "Public can view amenities for active venues"
on public.venue_amenities for select
using (
  exists (
    select 1 from public.venues v
    where v.id = venue_amenities.venue_id
      and (v.status = 'active' or v.owner_id = auth.uid())
  )
  or public.is_admin()
);

create policy "Venue owners manage their own venue's amenities"
on public.venue_amenities for insert
with check (
  exists (select 1 from public.venues v where v.id = venue_amenities.venue_id and v.owner_id = auth.uid())
);

create policy "Venue owners remove their own venue's amenities"
on public.venue_amenities for delete
using (
  exists (select 1 from public.venues v where v.id = venue_amenities.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);
