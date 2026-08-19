-- Exposes posts.event_id/club_id (20260810000070, 20260810000071)
-- through the feed RPC, so a client can render an embedded match card or
-- know a row belongs to a club feed without a second round trip.
--
-- CREATE OR REPLACE cannot change a function's return shape, so the old
-- signature is dropped first. Still SECURITY INVOKER — RLS on `posts`
-- already hides a club post from a non-member, so the union below
-- returns exactly what each caller may see, same as before.
drop function if exists public.court_side_feed(integer, timestamptz);

create function public.court_side_feed(
  p_limit integer default 20,
  p_cursor timestamptz default null
)
returns table (
  id uuid,
  user_id uuid,
  content text,
  image_url text,
  image_paths text[],
  event_id uuid,
  club_id uuid,
  like_count integer,
  comment_count integer,
  reshare_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  -- What the feed sorts and paginates on: the post's own time, or the
  -- reshare's when this row is a reshare.
  effective_at timestamptz,
  -- Null for an original post; the resharer for a reshare row.
  resharer_id uuid
)
language sql
security invoker
stable
set search_path = public
as $$
  select * from (
    select
      p.id, p.user_id, p.content, p.image_url, p.image_paths,
      p.event_id, p.club_id,
      p.like_count, p.comment_count, p.reshare_count,
      p.created_at, p.updated_at,
      p.created_at as effective_at,
      null::uuid as resharer_id
    from public.posts p

    union all

    select
      p.id, p.user_id, p.content, p.image_url, p.image_paths,
      p.event_id, p.club_id,
      p.like_count, p.comment_count, p.reshare_count,
      p.created_at, p.updated_at,
      r.created_at as effective_at,
      r.user_id as resharer_id
    from public.post_reshares r
    join public.posts p on p.id = r.post_id
    -- Resharing your own post would show it to your own followers
    -- twice, which reads as a bug rather than a feature.
    where r.user_id <> p.user_id
  ) feed
  where p_cursor is null or feed.effective_at < p_cursor
  order by feed.effective_at desc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.court_side_feed(integer, timestamptz) is
  'COURT/Side feed: posts unioned with reshares, ordered by effective_at so a '
  'reshare lifts a post back to the top. Also returns event_id/club_id. '
  'SECURITY INVOKER — RLS applies.';
