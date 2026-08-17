-- Club photos. `clubs.image_url` has existed since 20260810000034 and
-- nothing has ever written to it — there was no bucket and no upload
-- control, so every club renders as a blank card.
--
-- Same shape as post-images (20260810000033): public read, and writes
-- keyed on the first path segment being the uploader's id, so the object
-- path itself carries the ownership check.
--
--   club-images/<user_id>/<random>.<ext>
--
-- Keying on the UPLOADER rather than the club id is deliberate. Keying on
-- the club would need the policy to look up club_members to decide who may
-- write, which turns every image upload into a join against another
-- RLS-protected table; keying on the uploader keeps the storage policy a
-- pure string comparison, and the app's own write to clubs.image_url is
-- already gated by the clubs UPDATE policy (owner or club admin).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-images', 'club-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Public can view club images"
on storage.objects for select
using (bucket_id = 'club-images');

create policy "Users can upload their own club images"
on storage.objects for insert
with check (
  bucket_id = 'club-images'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

create policy "Users can delete their own club images"
on storage.objects for delete
using (
  bucket_id = 'club-images'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);
