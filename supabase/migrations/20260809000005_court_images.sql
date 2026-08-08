-- Schema only — no images are uploaded automatically. `storage_path` is
-- expected to point at an object in a Supabase Storage bucket (e.g.
-- `venue-images/<venue_id>/<file>`), created in a later phase alongside the
-- actual upload flow.
create table public.court_images (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  court_id uuid references public.courts (id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index court_images_venue_id_idx on public.court_images (venue_id);
create index court_images_court_id_idx on public.court_images (court_id);

alter table public.court_images enable row level security;

create policy "Public can view images for active venues"
on public.court_images for select
using (
  exists (
    select 1 from public.venues v
    where v.id = court_images.venue_id
      and (v.status = 'active' or v.owner_id = auth.uid())
  )
  or public.is_admin()
);

create policy "Venue owners manage images for their own venues"
on public.court_images for insert
with check (
  exists (select 1 from public.venues v where v.id = court_images.venue_id and v.owner_id = auth.uid())
);

create policy "Venue owners update images for their own venues"
on public.court_images for update
using (
  exists (select 1 from public.venues v where v.id = court_images.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
)
with check (
  exists (select 1 from public.venues v where v.id = court_images.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);

create policy "Venue owners remove images for their own venues"
on public.court_images for delete
using (
  exists (select 1 from public.venues v where v.id = court_images.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);
