-- Phase 7.1: COURT/Side community backend. Additive only. Gives the
-- previously client-only, non-persisted COURT/Side feed (posts, likes,
-- comments, follows, events) a real database. Deliberately minimal per
-- the brief ("do not overbuild messaging/chat yet") — no DMs, no
-- notification wiring here (that's Phase 7.5's job), no realtime.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 280),
  image_url text,
  -- Denormalized, trigger-maintained — same convention as
  -- venues.average_rating/review_count via update_venue_rating_stats()
  -- (20260809000007_reviews.sql), so the feed never has to count()
  -- likes/comments per post on every read.
  like_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index posts_user_id_idx on public.posts (user_id);
create index posts_created_at_idx on public.posts (created_at desc);

create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

create policy "Posts are publicly readable"
on public.posts for select
using (true);

create policy "Users can create posts as themselves"
on public.posts for insert
with check (auth.uid() = user_id);

create policy "Users can update their own posts"
on public.posts for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

create policy "Users can delete their own posts, admins moderate any"
on public.posts for delete
using (auth.uid() = user_id or public.is_admin());

-- One row per (post, user) — the composite primary key both indexes the
-- pair and is the uniqueness guarantee, same idiom as
-- favorites (20260809000006_favorites.sql): a like can't be duplicated,
-- and "did I like this" is a single-row lookup. Liking/unliking is
-- insert/delete, never update — a like is binary, so no update policy.
create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_likes_user_id_idx on public.post_likes (user_id);

alter table public.post_likes enable row level security;

create policy "Post likes are publicly readable"
on public.post_likes for select
using (true);

create policy "Users can like posts as themselves"
on public.post_likes for insert
with check (auth.uid() = user_id);

create policy "Users can unlike their own likes"
on public.post_likes for delete
using (auth.uid() = user_id or public.is_admin());

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 280),
  created_at timestamptz not null default now()
);

create index post_comments_post_id_idx on public.post_comments (post_id);
create index post_comments_user_id_idx on public.post_comments (user_id);

alter table public.post_comments enable row level security;

create policy "Post comments are publicly readable"
on public.post_comments for select
using (true);

create policy "Users can comment as themselves"
on public.post_comments for insert
with check (auth.uid() = user_id);

create policy "Users can delete their own comments, admins moderate any"
on public.post_comments for delete
using (auth.uid() = user_id or public.is_admin());

-- Maintains posts.like_count/comment_count — mirrors
-- update_venue_rating_stats()'s exact shape (recompute-from-source on
-- every insert/delete rather than increment/decrement, so it can never
-- drift even under concurrent writes).
create or replace function public.update_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
  set like_count = (select count(*) from public.post_likes where post_id = target_post_id)
  where id = target_post_id;
  return coalesce(new, old);
end;
$$;

create trigger post_likes_update_count
after insert or delete on public.post_likes
for each row execute function public.update_post_like_count();

create or replace function public.update_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
  set comment_count = (select count(*) from public.post_comments where post_id = target_post_id)
  where id = target_post_id;
  return coalesce(new, old);
end;
$$;

create trigger post_comments_update_count
after insert or delete on public.post_comments
for each row execute function public.update_post_comment_count();

-- One row per (follower, following) — same composite-PK dedup idiom as
-- post_likes/favorites. The self-follow guard is a plain CHECK: cheapest
-- possible enforcement, always applies regardless of caller.
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

create index follows_following_id_idx on public.follows (following_id);

alter table public.follows enable row level security;

create policy "Follows are publicly readable"
on public.follows for select
using (true);

create policy "Users can follow as themselves"
on public.follows for insert
with check (auth.uid() = follower_id);

create policy "Users can unfollow their own follows"
on public.follows for delete
using (auth.uid() = follower_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  event_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index events_event_at_idx on public.events (event_at);
create index events_creator_id_idx on public.events (creator_id);

alter table public.events enable row level security;

create policy "Events are publicly readable"
on public.events for select
using (true);

create policy "Users can create events as themselves"
on public.events for insert
with check (auth.uid() = creator_id);

create policy "Users can update their own events"
on public.events for update
using (auth.uid() = creator_id or public.is_admin())
with check (auth.uid() = creator_id or public.is_admin());

create policy "Users can delete their own events, admins moderate any"
on public.events for delete
using (auth.uid() = creator_id or public.is_admin());

-- Backs the "Join" button with real RSVP data — same composite-PK dedup
-- idiom as post_likes, so a user can't RSVP to the same event twice.
create table public.event_attendees (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_attendees_user_id_idx on public.event_attendees (user_id);

alter table public.event_attendees enable row level security;

create policy "Event attendees are publicly readable"
on public.event_attendees for select
using (true);

create policy "Users can RSVP as themselves"
on public.event_attendees for insert
with check (auth.uid() = user_id);

create policy "Users can cancel their own RSVP"
on public.event_attendees for delete
using (auth.uid() = user_id or public.is_admin());
