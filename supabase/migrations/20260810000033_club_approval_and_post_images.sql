-- Three changes:
--   1. Clubs now need admin approval before they are publicly visible.
--   2. Posts can carry up to 5 images.
--   3. A storage bucket for those images.

-- === 1. Club approval ===================================================

-- 7.8a shipped clubs as active-on-creation with a status column carrying
-- only 'active'/'suspended'. Adding 'pending_review' turns that column
-- into a real moderation queue, matching the vocabulary venues already
-- use (20260809000002_venues.sql).
alter table public.clubs drop constraint clubs_status_check;
alter table public.clubs add constraint clubs_status_check
  check (status in ('pending_review', 'active', 'suspended'));

alter table public.clubs alter column status set default 'pending_review';

create index clubs_status_idx on public.clubs (status);

-- Existing clubs stay as they are: anything already 'active' was created
-- under the old rules and shouldn't retroactively vanish from discovery.

-- A club awaiting review (or suspended) is visible only to its own
-- members and to admins — it must not appear in public discovery or
-- search. Replaces the 7.8a policy, which considered visibility alone.
drop policy "Clubs are readable unless private" on public.clubs;

create policy "Clubs are readable when approved, or to their own members"
on public.clubs for select
using (
  (status = 'active' and visibility <> 'private')
  or public.club_role_of(id) is not null
  or public.is_admin()
);

-- Only an admin may move a club between moderation states. Club owners
-- keep their existing update policy for name/description/etc., so this
-- trigger — not a policy — is what stops an owner self-approving.
create or replace function public.enforce_club_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger clubs_enforce_status_change
before update on public.clubs
for each row execute function public.enforce_club_status_change();

-- Tells the owner the outcome, mirroring notify_on_venue_moderation_change().
create or replace function public.notify_on_club_moderation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'active' and old.status = 'pending_review' then
      insert into public.notifications (user_id, type, title, message)
      values (new.owner_id, 'club_approved', 'Club approved', new.name || ' is now live on AIR/Rally.');
    elsif new.status = 'suspended' then
      insert into public.notifications (user_id, type, title, message)
      values (new.owner_id, 'club_suspended', 'Club suspended', new.name || ' has been suspended by a moderator.');
    end if;
  end if;
  return new;
end;
$$;

create trigger clubs_notify_on_moderation_change
after update on public.clubs
for each row execute function public.notify_on_club_moderation_change();

-- === 2. Post images =====================================================

-- posts.image_url (7.1) was a single nullable path that nothing ever
-- wrote — the composer had no upload. Rather than widen it, add a real
-- array with the 5-image cap enforced in the database, so the limit holds
-- regardless of what any client sends.
alter table public.posts
  add column image_paths text[] not null default '{}',
  add constraint posts_image_paths_max_5 check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 5);

-- === 3. Post image storage ==============================================

-- Same shape as the avatars bucket (20260810000022), except objects are
-- per-post rather than a single fixed path, so uploads accumulate under
-- `post-images/<user_id>/<random>`. The first path segment is the
-- uploader's id, which is what the write policies below key on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Public can view post images"
on storage.objects for select
using (bucket_id = 'post-images');

create policy "Users can upload their own post images"
on storage.objects for insert
with check (
  bucket_id = 'post-images'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

create policy "Users can delete their own post images"
on storage.objects for delete
using (
  bucket_id = 'post-images'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);
