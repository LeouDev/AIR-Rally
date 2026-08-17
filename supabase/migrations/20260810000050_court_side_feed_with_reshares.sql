-- Makes resharing actually do something.
--
-- Reshare has been half-built since 20260810000032: pressing it inserts a
-- post_reshares row, bumps reshare_count and notifies the author — and
-- then nothing surfaces the post anywhere. The feed reads `posts` directly,
-- newest-first, so a reshared post stays exactly where it was and the
-- resharer's followers never see it.
--
-- This RPC unions two things into one ordered stream:
--   * every post, at its own created_at
--   * every reshare, at the RESHARE's created_at, tagged with who did it
--
-- so a reshare lifts the post back to the top with a "reshared by" line,
-- which is what pressing the button visibly promises.
--
-- A post that has been reshared appears twice — once as itself, once per
-- reshare. That is deliberate and matches how every other feed behaves:
-- collapsing them would either hide the original from people who follow
-- its author, or hide the reshare from people who follow the resharer.
--
-- SECURITY INVOKER (the default, stated explicitly here because it
-- matters): this function must NOT bypass RLS. Migrations 047 and 048 both
-- closed holes created by SECURITY DEFINER functions reachable from a
-- browser session, and there is no reason to take that risk for a read
-- that RLS already permits — posts and reshares are both publicly
-- readable, so the invoker's own permissions are exactly right.
create or replace function public.court_side_feed(
  p_limit integer default 20,
  p_cursor timestamptz default null
)
returns table (
  id uuid,
  user_id uuid,
  content text,
  image_url text,
  image_paths text[],
  like_count integer,
  comment_count integer,
  reshare_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  -- What the feed sorts and paginates on: the post's own time, or the
  -- reshare's when this row is a reshare. The client never has to know
  -- which, so the existing cursor shape keeps working unchanged.
  effective_at timestamptz,
  -- Null for an original post; the resharer for a reshare row. Drives the
  -- "reshared by" attribution line.
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
      p.like_count, p.comment_count, p.reshare_count,
      p.created_at, p.updated_at,
      p.created_at as effective_at,
      null::uuid as resharer_id
    from public.posts p

    union all

    select
      p.id, p.user_id, p.content, p.image_url, p.image_paths,
      p.like_count, p.comment_count, p.reshare_count,
      p.created_at, p.updated_at,
      r.created_at as effective_at,
      r.user_id as resharer_id
    from public.post_reshares r
    join public.posts p on p.id = r.post_id
    -- Resharing your own post would show it to your own followers twice,
    -- which reads as a bug rather than a feature.
    where r.user_id <> p.user_id
  ) feed
  where p_cursor is null or feed.effective_at < p_cursor
  order by feed.effective_at desc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.court_side_feed(integer, timestamptz) is
  'COURT/Side feed: posts unioned with reshares, ordered by effective_at so a '
  'reshare lifts a post back to the top. SECURITY INVOKER — RLS applies.';
