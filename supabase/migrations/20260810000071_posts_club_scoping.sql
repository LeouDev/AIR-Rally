-- "My Club" — posts.club_id scopes a post to one club's own feed. RLS
-- reuses club_role_of() (20260810000029) exactly as clubs' own select
-- policy does, and extends the same check to post_likes/post_comments:
-- scoping only `posts` would still leave who liked a private post, and
-- what its comments say, readable straight from those tables regardless
-- of membership. post_reshares gets a narrower fix — see below.

alter table public.posts
  add column club_id uuid references public.clubs (id) on delete set null;

create index posts_club_id_idx on public.posts (club_id);

drop policy "Posts are publicly readable" on public.posts;
create policy "Posts are publicly readable, club posts are members-only"
on public.posts for select
using (club_id is null or public.club_role_of(club_id) is not null or public.is_admin());

drop policy "Users can create posts as themselves" on public.posts;
create policy "Users can create posts as themselves, club posts require membership"
on public.posts for insert
with check (
  auth.uid() = user_id
  and (club_id is null or public.club_role_of(club_id) is not null)
);

-- The insert policy above checked club_id at creation time; the existing
-- update policy (20260810000027) never gained the same check, so an
-- author could otherwise reassign club_id to a club they're not in
-- (locking themselves out of their own post, since the select policy
-- has no author-always-sees-it clause) or move an already-reshared
-- public post into a club after the fact — see the post_reshares fix
-- below for why that specifically matters.
drop policy "Users can update their own posts" on public.posts;
create policy "Users can update their own posts, club_id requires membership"
on public.posts for update
using (auth.uid() = user_id or public.is_admin())
with check (
  (auth.uid() = user_id or public.is_admin())
  and (club_id is null or public.club_role_of(club_id) is not null or public.is_admin())
);

-- === post_likes ==========================================================

drop policy "Post likes are publicly readable" on public.post_likes;
create policy "Post likes are readable if the post is"
on public.post_likes for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_likes.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
);

drop policy "Users can like posts as themselves" on public.post_likes;
create policy "Users can like readable posts as themselves"
on public.post_likes for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.posts p
    where p.id = post_likes.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null)
  )
);

-- === post_comments =======================================================

drop policy "Post comments are publicly readable" on public.post_comments;
create policy "Post comments are readable if the post is"
on public.post_comments for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
);

drop policy "Users can comment as themselves" on public.post_comments;
create policy "Users can comment on readable posts as themselves"
on public.post_comments for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null)
  )
);

-- === post_reshares ========================================================
-- court_side_feed() is the public, global feed. Letting a club-scoped
-- post be reshared would surface it there — visible to everyone the
-- resharer's followers are, regardless of club membership — which
-- defeats the select policy above no matter who does the resharing. So
-- resharing a club post is blocked outright rather than scoped.
--
-- That block only covers NEW reshares. A post can still go public ->
-- reshared -> reassigned to a club afterward (the post's own author, via
-- the update policy above — membership-checked, but not reshare-aware),
-- and post_reshares' own select policy was otherwise still "publicly
-- readable" — leaving that stale reshare row's who-and-when directly
-- queryable by a non-member even though the post itself now correctly
-- hides. Scoped the same way likes/comments are.

drop policy "Post reshares are publicly readable" on public.post_reshares;
create policy "Post reshares are readable if the post is"
on public.post_reshares for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_reshares.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
);

drop policy "Users can reshare as themselves" on public.post_reshares;
create policy "Users can reshare non-club posts as themselves"
on public.post_reshares for insert
with check (
  auth.uid() = user_id
  and exists (select 1 from public.posts p where p.id = post_reshares.post_id and p.club_id is null)
);
