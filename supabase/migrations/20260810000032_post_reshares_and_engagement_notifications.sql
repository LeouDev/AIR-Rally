-- Reshare, plus notifications for the three ways someone can engage with
-- your post: mentioning you, liking it, or resharing it.
--
-- Reshare did not exist before this migration — the feed's reshare button
-- was a "coming soon" toast — so notifying on it means building it. It is
-- modelled exactly on post_likes: composite PK for dedup, a
-- trigger-maintained count, insert to reshare and delete to undo.
--
-- These are IN-APP notifications (the notifications table + the existing
-- bell). This codebase has no web-push or device-token infrastructure, so
-- nothing here reaches a phone's lock screen.

-- === Reshares ===========================================================

create table public.post_reshares (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_reshares_user_id_idx on public.post_reshares (user_id);

alter table public.post_reshares enable row level security;

create policy "Post reshares are publicly readable"
on public.post_reshares for select
using (true);

create policy "Users can reshare as themselves"
on public.post_reshares for insert
with check (auth.uid() = user_id);

create policy "Users can undo their own reshare"
on public.post_reshares for delete
using (auth.uid() = user_id or public.is_admin());

alter table public.posts
  add column reshare_count integer not null default 0;

-- Recompute-from-source, same as update_post_like_count().
create or replace function public.update_post_reshare_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
  set reshare_count = (select count(*) from public.post_reshares where post_id = target_post_id)
  where id = target_post_id;
  return coalesce(new, old);
end;
$$;

create trigger post_reshares_update_count
after insert or delete on public.post_reshares
for each row execute function public.update_post_reshare_count();

-- === Structured mentions ================================================

-- Who a post actually tagged. Derived from the composer's picker at post
-- time, not by re-parsing the text: a display name's first token ("@Lea")
-- is not unique, so text alone cannot identify a recipient. A mention
-- typed by hand without choosing from the picker records no row and
-- therefore notifies nobody — deliberate, since guessing the wrong Lea is
-- worse than staying quiet.
create table public.post_mentions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_mentions_user_id_idx on public.post_mentions (user_id);

alter table public.post_mentions enable row level security;

create policy "Post mentions are publicly readable"
on public.post_mentions for select
using (true);

-- Only the post's own author may record who it mentions, so nobody can
-- fabricate a mention of a third party on someone else's post.
create policy "Post authors record their own post's mentions"
on public.post_mentions for insert
with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

create policy "Post authors and admins can remove mentions"
on public.post_mentions for delete
using (
  exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  or public.is_admin()
);

-- === Engagement notifications ===========================================
-- Same SECURITY DEFINER shape as notify_on_booking_change(). Each one
-- skips self-engagement: being told you liked your own post is noise.

create or replace function public.notify_on_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor_name text;
begin
  select user_id into v_author_id from public.posts where id = new.post_id;
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_author_id, 'post_liked', 'New like', coalesce(v_actor_name, 'Someone') || ' liked your post.');

  return new;
end;
$$;

create trigger post_likes_notify
after insert on public.post_likes
for each row execute function public.notify_on_post_like();

create or replace function public.notify_on_post_reshare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor_name text;
begin
  select user_id into v_author_id from public.posts where id = new.post_id;
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_author_id, 'post_reshared', 'Post reshared', coalesce(v_actor_name, 'Someone') || ' reshared your post.');

  return new;
end;
$$;

create trigger post_reshares_notify
after insert on public.post_reshares
for each row execute function public.notify_on_post_reshare();

create or replace function public.notify_on_post_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor_name text;
begin
  select user_id into v_author_id from public.posts where id = new.post_id;
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = v_author_id;

  insert into public.notifications (user_id, type, title, message)
  values (new.user_id, 'post_mention', 'You were mentioned', coalesce(v_actor_name, 'Someone') || ' mentioned you in a post.');

  return new;
end;
$$;

create trigger post_mentions_notify
after insert on public.post_mentions
for each row execute function public.notify_on_post_mention();
