-- Fixes a pre-existing bug in the venue-images storage RLS policies from
-- supabase/migrations/20260809000009_venue_images_storage.sql, discovered
-- during live staging verification of the first real upload path this
-- project has ever exercised (see
-- scripts/verify-staging-venue-images.ts) — this bug predates this
-- feature and is not introduced by it.
--
-- The original policies wrote `(storage.foldername(name))[1]` intending
-- `name` to mean the uploaded object's own path (storage.objects.name).
-- But because the correlated subquery's FROM clause is
-- `public.venues v`, and `venues` has its own `name` column, standard
-- SQL scoping resolves the bare `name` to `v.name` (the venue's display
-- name) instead of the outer storage.objects.name — confirmed via
-- `select policyname, with_check from pg_policies where tablename =
-- 'objects'`, which shows the compiled expression as
-- `storage.foldername(v.name)`. Since a venue's display name is never a
-- slash-separated path matching its own id, this silently denied every
-- real owner's insert/update/delete against this bucket — the SELECT
-- policy (`bucket_id = 'venue-images'`, no `name` reference at all) was
-- never affected, which is why this went uncaught: reads always worked,
-- only writes were secretly broken, and nothing wrote to this bucket
-- until now.
--
-- Fix: qualify the object's own path explicitly as `objects.name` (the
-- table's own unqualified name is a valid implicit alias for its row
-- inside a USING/WITH CHECK expression), which resolves unambiguously to
-- storage.objects.name regardless of what columns the subquery's own
-- FROM list happens to have.
drop policy "Venue owners can upload images for their own venues" on storage.objects;
create policy "Venue owners can upload images for their own venues"
on storage.objects for insert
with check (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(objects.name))[1]
      and v.owner_id = auth.uid()
  )
);

drop policy "Venue owners can update images for their own venues" on storage.objects;
create policy "Venue owners can update images for their own venues"
on storage.objects for update
using (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(objects.name))[1]
      and v.owner_id = auth.uid()
  )
);

drop policy "Venue owners can delete images for their own venues" on storage.objects;
create policy "Venue owners can delete images for their own venues"
on storage.objects for delete
using (
  bucket_id = 'venue-images'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(objects.name))[1]
      and v.owner_id = auth.uid()
  )
);
