-- Prepares Supabase Storage for venue/court photos. No upload UI exists
-- yet (see ARCHITECTURE.md) — this just makes the bucket + access rules
-- real and correct ahead of that, matching `storage_path` on
-- `court_images` (see supabase/migrations/20260809000005_court_images.sql).
-- Objects are expected at `venue-images/<venue_id>/<filename>`.

insert into storage.buckets (id, name, public)
values ('venue-images', 'venue-images', true)
on conflict (id) do nothing;

-- Public bucket reads typically don't need an RLS policy (Supabase serves
-- public-bucket objects directly), but this is added explicitly so the
-- `storage.objects` API (list/download) behaves the same way, not just
-- the public URL endpoint.
create policy "Public can view venue images"
on storage.objects for select
using (bucket_id = 'venue-images');

create policy "Venue owners can upload images for their own venues"
on storage.objects for insert
with check (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(name))[1]
      and v.owner_id = auth.uid()
  )
);

create policy "Venue owners can update images for their own venues"
on storage.objects for update
using (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(name))[1]
      and v.owner_id = auth.uid()
  )
);

create policy "Venue owners can delete images for their own venues"
on storage.objects for delete
using (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(name))[1]
      and v.owner_id = auth.uid()
  )
);
