-- COURT/Side gains a 'Following' tab, so court_side_feed() needs a scope.
--
-- Client-side filtering was ruled out and correctly: the feed pages at 20
-- rows on effective_at, so filtering after the fetch gives someone who
-- follows three people near-empty pages and a cursor that skips content.
-- The filter has to be applied before the limit, which means in here.
--
-- WHY THE DROP BELOW IS THE POINT, NOT HOUSEKEEPING
--
-- Adding p_scope while leaving the old 2-argument function in place would
-- create an overload, and PostgREST resolves an RPC by the argument names
-- the caller supplies. Every existing caller would keep resolving to the
-- 2-arg version and keep silently receiving an unfiltered feed — the exact
-- bug this migration exists to close, surviving the migration that closes
-- it. Worse than doing nothing, because it would look fixed.
--
-- With the old signature dropped, a caller that has not been updated fails
-- loudly instead of quietly getting the wrong answer. Measured on staging:
-- HTTP 404 with Postgres code 42883 ("function does not exist") — NOT
-- PGRST202, which is what we assumed before measuring. Anyone writing a
-- client check, log filter or alert should match 42883. That is the intended blast radius: both clients
-- must be updated in the same release.
--
-- p_scope is REQUIRED and has NO DEFAULT for the same reason. A default
-- meaning "everything" is a parameter whose omission looks like a working
-- call, and that is how 'Following' shipped as a tab that lied to users.

create type public.court_side_scope as enum ('for_you', 'following');

-- NO DROP HERE — deliberately. This is the EXPAND half of an
-- expand/contract pair; the drop lives in 20260810000079.
--
-- Dropping the 2-arg function in the same migration that creates the 4-arg
-- one would break every already-shipped mobile build the moment it landed
-- on production. A mobile binary cannot be force-updated, so "until the
-- clients deploy" has no end date on that platform: a user who declines to
-- update keeps calling the 2-arg function indefinitely and their COURT/Side
-- feed would simply stop loading, permanently. Web is fine either way
-- (Vercel, next page load); mobile is not.
--
-- There is also no ordering that avoids this. A client deployed to call the
-- 4-arg signature before the migration lands gets HTTP 404 / 42883 immediately, so
-- "clients first" fails exactly as hard as "migration first" — two mutually
-- exclusive states, two independently deploying systems.
--
-- So the two coexist for a while. They resolve unambiguously because
-- p_scope has NO DEFAULT: a call supplying {p_limit, p_cursor} cannot
-- satisfy the 4-arg and can only match the 2-arg, and a call supplying
-- p_scope cannot match the 2-arg at all. That safety falls out of the
-- no-silent-default rule rather than being designed for it.
--
-- During the expand window the surviving 2-arg keeps returning an
-- unfiltered feed on the old single-column cursor — which is exactly
-- today's behaviour, so nothing regresses and no new caller reaches it.

create function public.court_side_feed(
  p_scope     public.court_side_scope,
  p_limit     integer     default 20,
  p_cursor    timestamptz default null,
  p_cursor_id uuid        default null
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
language plpgsql
-- SECURITY INVOKER, unchanged and deliberate: RLS is the boundary in this
-- schema and must keep applying to the caller. auth.uid() resolves normally
-- under invoker.
security invoker
stable
set search_path = public
as $$
-- RETURNS TABLE declares OUT parameters named id, user_id, created_at and so
-- on, which collide with the column names used throughout the query below.
-- Resolve ambiguity to the column, never the parameter.
#variable_conflict use_column
begin
  -- A half-supplied cursor must fail loudly rather than silently reverting
  -- to the ambiguous single-column behaviour this migration removes. Two
  -- optional arguments that only work when supplied together are the same
  -- species of trap as an optional scope: omission that looks like a
  -- working call. plpgsql rather than SQL specifically to make this
  -- raiseable — the function is called as a bare `select * from
  -- court_side_feed(...)` by both clients with no additional predicates, so
  -- the lost SQL-inlining costs nothing measurable here.
  if (p_cursor is null) <> (p_cursor_id is null) then
    raise exception
      'court_side_feed: p_cursor and p_cursor_id must be supplied together (got cursor=%, cursor_id=%)',
      p_cursor, p_cursor_id
      using errcode = '22023';
  end if;

  return query
  select * from (
    -- Original posts: in 'following' when you follow the AUTHOR, or when
    -- the post is your own. Own posts are included deliberately — a user
    -- who posts and then cannot find it in their own feed reads that as
    -- broken, and they would be half right. follows_no_self_follow means
    -- the exists() below can never cover this case, so it is explicit.
    select
      p.id, p.user_id, p.content, p.image_url, p.image_paths,
      p.event_id, p.club_id,
      p.like_count, p.comment_count, p.reshare_count,
      p.created_at, p.updated_at,
      p.created_at as effective_at,
      null::uuid as resharer_id
    from public.posts p
    where p_scope = 'for_you'
       or p.user_id = auth.uid()
       or exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = p.user_id
          )

    union all

    -- Reshares: in 'following' when you follow the RESHARER, not the
    -- author. A person you follow amplifying a stranger should reach you —
    -- that is what a reshare is for. Matching on the author instead would
    -- make reshares invisible in the one feed where they matter most.
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
      and (
        p_scope = 'for_you'
        or r.user_id = auth.uid()
        or exists (
             select 1 from public.follows f
             where f.follower_id = auth.uid() and f.following_id = r.user_id
           )
      )
  ) feed
  -- Composite keyset cursor. effective_at alone is NOT unique — a post and
  -- a reshare, or two posts, can share an instant — so a strict `<` on it
  -- alone duplicates or skips rows that straddle a page boundary. That bug
  -- is live in the 2-arg function today; it is not introduced here. A
  -- filtered scope makes it bite harder, because a sparse Following set
  -- means paging deeper and crossing more boundaries per unit of content.
  -- Adding id as a tiebreaker makes the cursor total.
  where p_cursor is null
     or (feed.effective_at, feed.id) < (p_cursor, p_cursor_id)
  order by feed.effective_at desc, feed.id desc
  limit greatest(1, least(p_limit, 50));
end;
$$;

comment on function public.court_side_feed(public.court_side_scope, integer, timestamptz, uuid) is
  'COURT/Side feed: posts unioned with reshares, ordered by (effective_at, id) desc so a '
  'reshare lifts a post back to the top and the keyset cursor is total. p_scope is required '
  'and has no default: for_you returns everything (behaviourally identical to the previous '
  '2-arg function apart from the tiebreaker and cursor), following returns posts by people '
  'you follow, reshares by people you follow, and your own. SECURITY INVOKER — RLS applies. '
  'An anonymous caller gets zero rows for following; clients must hide the tab when signed out.';
