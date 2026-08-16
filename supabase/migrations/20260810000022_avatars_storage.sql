-- Storage for profile pictures, usable by any authenticated user
-- regardless of role (player, venue_owner, admin all share the one
-- `profiles.avatar_url` column — see 20260809000001_profiles.sql).
-- Objects live at `avatars/<user_id>/avatar`, a single fixed path per
-- user (no extension, no random suffix) so a re-upload cleanly
-- overwrites in place via `upsert: true` instead of accumulating
-- orphaned files — see src/lib/services/avatars.ts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Public can view avatars"
on storage.objects for select
using (bucket_id = 'avatars');

-- `objects.name` is qualified explicitly (not bare `name`) per the fix in
-- 20260810000019_fix_venue_images_storage_rls.sql — no join here means
-- this specific query has no competing `name` column to collide with, but
-- qualifying it keeps every storage policy in this project consistent.
create policy "Users can upload their own avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

create policy "Users can replace their own avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

create policy "Users can delete their own avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);
