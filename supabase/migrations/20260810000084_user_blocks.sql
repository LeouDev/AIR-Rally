-- User blocking (Apple App Store Guideline 1.2 — the "block" half; content
-- reporting already exists, web-only). Scope and product-safety decisions
-- below were reached jointly tonight; see the AI CTO/backend-engineer
-- session log for the full reasoning trail. Summarized here so this
-- migration is legible on its own.
--
-- CORE DISTINCTION THIS MIGRATION IS BUILT AROUND:
--
--   social noise    — the notification IS the harm; suppressing it closes
--                     the harm entirely (a like, a comment, a mention).
--   commitment      — the notification only ANNOUNCES a real, already-
--                     formed arrangement; suppressing the alert removes
--                     the victim's only warning while the arrangement
--                     itself still exists. AIR/Rally schedules real
--                     physical meetups, so this class is not hypothetical.
--
-- WHAT'S IN SCOPE HERE, AND WHY:
--
--   * Rosters (event_attendees) are NOT filtered and NOT touched. A block
--     must never hide who you will physically meet — an identity-hiding
--     mechanism with exceptions has already proven, elsewhere tonight, that
--     it can't be trusted to compose safely. Full visibility of who's
--     coming stays absolute.
--   * public_profiles is NOT filtered, for the same reason plus a concrete
--     one: rosters render attendee names via public_profiles
--     (src/lib/services/events.ts) — filtering it would silently break the
--     very roster names that must stay informative.
--   * Feed/social content (posts, comments, reshares, mentions) IS
--     filtered — this is "social noise" territory with no physical-safety
--     downside to hiding it.
--   * follows: a block SEVERS any existing follow edge between the two
--     users (both directions) and refuses a new one, rather than merely
--     hiding it — an active relationship reversal, not a passive filter.
--   * invite_event_players() and create_ranked_match() are COMMITMENT
--     writers, not social noise, and are fixed at the RPC itself (refuse
--     the action), never by suppressing only their notification — see the
--     per-function comments below for why suppression alone would have
--     been worse than doing nothing.
--   * The three ranked-match lifecycle notifications
--     (ranked_officiating_confirmed, ranked_result_submitted,
--     ranked_result_disputed) are DELIBERATELY NOT suppressed. Once a
--     match exists, these are operationally necessary regardless of block
--     status — suppressing ranked_result_submitted/disputed specifically
--     would strip a blocked player's ability to see and dispute a result
--     filed against them, a correctness harm on top of a safety one.
--   * Reviews are explicitly deferred — not touched here.
--
-- THE is_blocked_pair() PRIVACY SUBTLETY (read this before trusting the
-- function below): a two-argument SECURITY DEFINER predicate usable
-- inside an RLS policy MUST be directly EXECUTE-granted to
-- authenticated/anon for that policy to evaluate at all — and in this
-- codebase's single-schema, all-functions-in-`public` layout, that same
-- grant is what PostgREST uses to expose ANY function as a callable RPC.
-- There is no way to grant "usable only from inside an RLS policy, not
-- directly callable" with what this schema has today (no private/
-- non-exposed schema exists yet). So is_blocked_pair(a, b) IS reachable
-- as a bare RPC by any authenticated user, for any two ids they choose,
-- unless the function itself refuses that.
--
-- Mitigated, not eliminated: the function refuses to answer for a pair
-- neither of whose members is the caller (returns false unconditionally),
-- which stops a stranger from mapping arbitrary users' block graphs. It
-- does NOT stop a user from learning "does X have me blocked" by calling
-- is_blocked_pair(me, X) directly — since user_blocks' own RLS only ever
-- shows a user their OWN outgoing blocks (blocker_id = auth.uid()), an
-- incoming block against them is otherwise invisible to their own
-- session, and this function's whole reason for being SECURITY DEFINER is
-- to see across that boundary for correct bidirectional content
-- filtering. That correctness requirement and the probe risk are the same
-- code path.
--
-- NAMED SECURITY GAP, ACCEPTED FOR LAUNCH — not closed, not vague:
-- a determined party can learn they've been blocked by calling
-- is_blocked_pair(self, target) directly as an RPC, for any target id
-- they choose, bypassing the UI entirely. Accepted because exploiting it
-- requires knowing this API surface well enough to call a raw RPC with
-- two specific user ids — not a path a casual harasser stumbles into —
-- but the population this feature exists to protect against can include
-- exactly that kind of technical persistence, so this is not being
-- treated as closed. REVOKE-based mitigation does not work either: an
-- RLS policy evaluates with the querying role's own privileges, so
-- revoking EXECUTE from authenticated/anon breaks the policy along with
-- the direct call — there's no Postgres/PostgREST grant shape in this
-- single-schema layout that allows one without the other. The real fix
-- is moving this function (and the RLS policies that call it) into a
-- private, non-PostgREST-exposed schema — an architectural change bigger
-- than this migration, not a follow-up someday: the next trust-and-safety
-- work after launch, ahead of new features. Track on the release
-- checklist as a named gap, not folded into general post-launch cleanup.
--
-- Every SECURITY-DEFINER writer that needs a block check OUTSIDE an RLS
-- policy (the notify_on_* triggers, invite_event_players,
-- create_ranked_match) queries public.user_blocks directly instead of
-- calling is_blocked_pair() — those functions already run with elevated
-- privilege and bypass user_blocks' RLS naturally, and inlining avoids
-- creating a second, differently-shaped probe surface.
--
-- NO is_admin() EXEMPTION anywhere in this migration — blocking is a
-- user's own social boundary; nothing here identifies a legitimate,
-- currently-existing admin need to see through it.
--
-- NO BACKFILL — there is nothing to backfill; this is new state with no
-- prior rows.

-- =============================================================================
-- Table + RLS
-- =============================================================================

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self_block check (blocker_id <> blocked_id)
);

-- Powers is_blocked_pair()'s "was I the one blocked" direction and every
-- inline block-check's second disjunct.
create index user_blocks_blocked_id_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Deliberately NOT publicly readable, unlike every other table in this
-- schema — a user sees only blocks THEY made. Seeing who has blocked YOU
-- is exactly the information a block exists to keep from its target.
create policy "Users can view their own outgoing blocks"
on public.user_blocks for select
using ((select auth.uid()) = blocker_id);

create policy "Users can block as themselves"
on public.user_blocks for insert
with check ((select auth.uid()) = blocker_id);

create policy "Users can unblock their own blocks"
on public.user_blocks for delete
using ((select auth.uid()) = blocker_id);

-- =============================================================================
-- is_blocked_pair() — for RLS USING clauses only. See the header comment
-- above for the probe-surface tradeoff this function's own restriction
-- (caller must be one of the two parties) mitigates but does not eliminate.
-- =============================================================================

create or replace function public.is_blocked_pair(p_user_a uuid, p_user_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_a and auth.uid() is distinct from p_user_b then
    return false;
  end if;

  return exists (
    select 1 from public.user_blocks
    where (blocker_id = p_user_a and blocked_id = p_user_b)
       or (blocker_id = p_user_b and blocked_id = p_user_a)
  );
end;
$$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated, anon;

-- =============================================================================
-- list_my_blocks() — the unblock-UI's data source. Deliberately the ONLY
-- sanctioned way to read your own block list beyond user_blocks' own
-- (already-safe) SELECT policy — this just joins in display data.
-- =============================================================================

create or replace function public.list_my_blocks()
returns table (blocked_id uuid, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ub.blocked_id, p.display_name, p.avatar_url, ub.created_at
  from public.user_blocks ub
  join public.profiles p on p.id = ub.blocked_id
  where ub.blocker_id = auth.uid()
  order by ub.created_at desc;
$$;

revoke all on function public.list_my_blocks() from public, anon;
grant execute on function public.list_my_blocks() to authenticated;

-- =============================================================================
-- Content-table SELECT filtering — social noise, not commitments. Rosters
-- (event_attendees) and public_profiles are deliberately absent from this
-- list; see the header comment.
--
-- 20260810000071 (read fresh against staging's actual live policies while
-- verifying this migration, not assumed from an earlier read of the
-- migration tree) already layered club-membership scoping onto posts,
-- post_likes, post_comments, and post_reshares' SELECT policies — this
-- was NOT visible from the original table definitions alone. Every
-- policy below ANDs the block check onto that existing club-membership
-- check rather than replacing it, so a club-scoped post stays exactly as
-- private as 071 made it, plus now also hidden from a blocked pair.
--
-- post_likes is included here even though it wasn't named in this
-- feature's original scope list (posts/comments/reshares/mentions/
-- follows) — 071's own reasoning ("scoping only posts would still leave
-- who liked a private post... readable") applies identically to
-- blocking: leaving post_likes unfiltered would let a blocked pair see
-- who liked each other's posts even once the posts themselves are
-- hidden. Treated as part of the same set 071 already treats it as.
-- =============================================================================

drop policy "Posts are publicly readable, club posts are members-only" on public.posts;
create policy "Posts readable, club members-only, blocked pairs excepted"
on public.posts for select
using (
  (club_id is null or public.club_role_of(club_id) is not null or public.is_admin())
  and (
    (select auth.uid()) is null
    or user_id = (select auth.uid())
    or not public.is_blocked_pair(user_id, (select auth.uid()))
  )
);

drop policy "Post likes are readable if the post is" on public.post_likes;
create policy "Post likes are readable if the post is, blocked pairs excepted"
on public.post_likes for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_likes.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
  and (
    (select auth.uid()) is null
    or user_id = (select auth.uid())
    or not public.is_blocked_pair(user_id, (select auth.uid()))
  )
);

drop policy "Post comments are readable if the post is" on public.post_comments;
create policy "Post comments readable, blocked pairs excepted"
on public.post_comments for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
  and (
    (select auth.uid()) is null
    or user_id = (select auth.uid())
    or not public.is_blocked_pair(user_id, (select auth.uid()))
  )
);

drop policy "Post reshares are readable if the post is" on public.post_reshares;
create policy "Post reshares readable, blocked pairs excepted"
on public.post_reshares for select
using (
  exists (
    select 1 from public.posts p
    where p.id = post_reshares.post_id
      and (p.club_id is null or public.club_role_of(p.club_id) is not null or public.is_admin())
  )
  and (
    (select auth.uid()) is null
    or user_id = (select auth.uid())
    or not public.is_blocked_pair(user_id, (select auth.uid()))
  )
);

-- post_mentions was never touched by 071 — still the original, unscoped
-- "publicly readable" shape, so only the block check is new here.
drop policy "Post mentions are publicly readable" on public.post_mentions;
create policy "Post mentions are publicly readable, blocked pairs excepted"
on public.post_mentions for select
using (
  (select auth.uid()) is null
  or user_id = (select auth.uid())
  or not public.is_blocked_pair(user_id, (select auth.uid()))
);

-- =============================================================================
-- follows — severed, not filtered. A block actively reverses an existing
-- follow relationship rather than merely hiding it from view.
-- =============================================================================

drop policy "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves, unless blocked"
on public.follows for insert
with check (
  (select auth.uid()) = follower_id
  and not public.is_blocked_pair(follower_id, following_id)
);

create or replace function public.sever_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return new;
end;
$$;

create trigger user_blocks_sever_follows
after insert on public.user_blocks
for each row execute function public.sever_follows_on_block();

-- =============================================================================
-- Notification suppression — confirmed actor-driven writers only (grepped
-- "insert into public.notifications" across every migration, not the
-- notify_on_* naming convention — that convention alone missed
-- invite_event_players and create_ranked_match, handled separately below
-- since both are commitment writers, not social noise).
--
-- NOT suppressed, deliberately: waitlist_promoted (queue-driven, no
-- specific actor), the three ranked-match lifecycle notifications, and
-- every system/admin writer (see this migration's header comment).
-- Each function below is otherwise byte-for-byte unchanged from its
-- current definition — only the block-check + early return is new.
-- =============================================================================

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

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_author_id and blocked_id = new.user_id)
       or (blocker_id = new.user_id and blocked_id = v_author_id)
  ) then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_author_id, 'post_liked', 'New like', coalesce(v_actor_name, 'Someone') || ' liked your post.');

  return new;
end;
$$;

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

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_author_id and blocked_id = new.user_id)
       or (blocker_id = new.user_id and blocked_id = v_author_id)
  ) then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_author_id, 'post_reshared', 'Post reshared', coalesce(v_actor_name, 'Someone') || ' reshared your post.');

  return new;
end;
$$;

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

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_author_id and blocked_id = new.user_id)
       or (blocker_id = new.user_id and blocked_id = v_author_id)
  ) then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into v_actor_name from public.profiles where id = v_author_id;

  insert into public.notifications (user_id, type, title, message)
  values (new.user_id, 'post_mention', 'You were mentioned', coalesce(v_actor_name, 'Someone') || ' mentioned you in a post.');

  return new;
end;
$$;

create or replace function public.notify_on_club_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_name text;
begin
  select owner_id, name into v_owner_id, v_name from public.clubs where id = new.club_id;
  if v_owner_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_owner_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_owner_id)
    ) then
      insert into public.notifications (user_id, type, title, message)
      values (
        v_owner_id,
        'club_join_request',
        'New club join request',
        'Someone asked to join ' || v_name || '.'
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_owner_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_owner_id)
    ) then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.user_id,
        'club_membership_approved',
        'Club request approved',
        'You are now a member of ' || v_name || '.'
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
  v_title text;
begin
  select creator_id, title into v_creator_id, v_title from public.events where id = new.event_id;
  if v_creator_id is null then
    return new;
  end if;

  if new.status = 'pending_approval' and (tg_op = 'INSERT' or old.status is distinct from 'pending_approval') then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_creator_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_creator_id)
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        v_creator_id, 'event_join_request', 'New join request',
        'Someone asked to join ' || v_title || '.', '/events/' || new.event_id
      );
    end if;
  elsif tg_op = 'INSERT' and new.status = 'joined' and new.user_id <> v_creator_id then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_creator_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_creator_id)
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        v_creator_id, 'event_registration', 'New event registration',
        'A player joined ' || v_title || '.', '/events/' || new.event_id
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status in ('joined', 'waitlisted') then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_creator_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_creator_id)
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        new.user_id,
        'event_join_approved',
        'Request approved',
        case when new.status = 'joined'
          then 'You''re in for ' || v_title || '.'
          else 'You''re on the waitlist for ' || v_title || '.'
        end,
        '/events/' || new.event_id
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status = 'cancelled' then
    if not exists (
      select 1 from public.user_blocks
      where (blocker_id = v_creator_id and blocked_id = new.user_id)
         or (blocker_id = new.user_id and blocked_id = v_creator_id)
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        new.user_id, 'event_join_declined', 'Request declined',
        'Your request to join ' || v_title || ' was declined.', '/events/' || new.event_id
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'waitlisted' and new.status = 'joined' then
    -- NOT block-checked: promote_event_waitlist() promotes by queue order,
    -- not by any person's direct action. There is no actor here to filter
    -- on, and this is operationally necessary regardless of block status.
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      new.user_id, 'waitlist_promoted', 'A spot opened up',
      'You are off the waitlist for ' || v_title || '.', '/events/' || new.event_id
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_review_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.venues where id = new.venue_id;

  if v_owner_id is not null and not exists (
    select 1 from public.user_blocks
    where (blocker_id = v_owner_id and blocked_id = new.user_id)
       or (blocker_id = new.user_id and blocked_id = v_owner_id)
  ) then
    insert into public.notifications (user_id, type, title, message)
    values (
      v_owner_id,
      'review_received',
      'New review received',
      'Your venue received a new ' || new.rating || '-star review.'
    );
  end if;

  return new;
end;
$$;

-- =============================================================================
-- invite_event_players() — COMMITMENT writer, fixed at the RPC, not by
-- suppressing its notification. invite_event_players() never actually
-- adds anyone to event_attendees — joining still requires the invitee's
-- own separate, consenting action under their own identity (see
-- 20260810000045's own header comment) — so suppressing only the
-- notification here would have been WORSE than doing nothing: the
-- organiser's invite would silently vanish with no record anywhere, but
-- nothing about the underlying "can this pair even be invited" question
-- would be closed, and a future code path with a different notification
-- shape could reopen the same hole. Skipped exactly like the existing
-- self-invite skip, silently — no error, no notification, and no
-- observable difference to the caller between "already invited" and
-- "blocked", which is deliberate: this RPC must not become a new way to
-- learn block status.
-- =============================================================================

-- Based on 20260810000046's current definition (the link_url-keyed
-- dedup), not 20260810000045's original — checked live against staging's
-- actual function body before writing this, not assumed from an earlier
-- read of the migration tree.
create or replace function public.invite_event_players(p_event_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_inviter_name text;
  v_count integer := 0;
  v_user_id uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found.' using errcode = 'no_data_found';
  end if;

  if v_event.creator_id is distinct from auth.uid() then
    raise exception 'Only the event organiser can invite players.' using errcode = 'insufficient_privilege';
  end if;

  if v_event.status is distinct from 'published' then
    raise exception 'This event is no longer open.' using errcode = 'check_violation';
  end if;

  if array_length(p_user_ids, 1) is null or array_length(p_user_ids, 1) > 20 then
    raise exception 'Invite between 1 and 20 players at a time.' using errcode = 'check_violation';
  end if;

  select coalesce(display_name, 'A player') into v_inviter_name
  from public.profiles where id = auth.uid();

  foreach v_user_id in array p_user_ids loop
    continue when v_user_id = auth.uid();

    continue when exists (
      select 1 from public.user_blocks
      where (blocker_id = auth.uid() and blocked_id = v_user_id)
         or (blocker_id = v_user_id and blocked_id = auth.uid())
    );

    if not exists (
      select 1 from public.notifications
      where user_id = v_user_id
        and type = 'event_invite'
        and link_url = '/events/' || v_event.id
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        v_user_id,
        'event_invite',
        v_inviter_name || ' invited you to a game',
        v_inviter_name || ' added you to "' || v_event.title || '". Tap to view and confirm your spot.',
        '/events/' || v_event.id
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- create_ranked_match() — ALSO a commitment writer, and a stronger case
-- than invite_event_players(): it inserts into ranked_match_players
-- immediately and unconditionally for every named player, forming the
-- match record and the association itself before anyone but the caller
-- has done anything. set_ranked_ready() only gates the match's exit from
-- 'lobby' into 'officiating' — it never gates membership, visibility, or
-- the row's existence. So unlike invite_event_players (which creates no
-- roster row at all until the invitee separately, consentingly joins),
-- here the unwanted association is real and immediate the moment the
-- function returns. Rejected outright, not per-recipient-skipped like
-- invites: a match can't "partially form," so the whole call fails.
--
-- Checked PAIRWISE across every named player, not just caller-vs-others —
-- the caller assembles ALL of team_a and team_b, including people who
-- aren't them, so two OTHER named players who've blocked each other must
-- also be caught (doubles: a well-meaning organiser could otherwise put
-- two blocked-pair players on the same court). The error message is
-- deliberately generic and never names which pair or direction — the
-- point of a block is that its existence isn't confirmed to either side
-- through a side channel like this one.
-- =============================================================================

-- Based on 20260810000068's current definition (mode-specific ranks, the
-- 250-AAR-point spread cap, the `mode` column on ranked_match_players) —
-- checked live against staging's actual function body first, not the
-- earlier 20260810000067 version this table's own history might suggest.
create or replace function public.create_ranked_match(
  p_match_type text,
  p_team_a uuid[],
  p_team_b uuid[],
  p_event_id uuid default null,
  p_court_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_season smallint := public.current_ranked_season();
  v_expected integer;
  v_all uuid[];
  v_match_id uuid;
  v_venue_id uuid;
  v_user_id uuid;
  v_spread integer;
  c_max_party_spread constant integer := 250;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;
  if v_season is null then
    raise exception 'Ranked is between seasons right now.' using errcode = 'AR001';
  end if;
  if p_match_type not in ('singles', 'doubles') then
    raise exception 'Pick singles or doubles.' using errcode = 'AR001';
  end if;

  v_expected := case when p_match_type = 'doubles' then 2 else 1 end;
  if coalesce(array_length(p_team_a, 1), 0) <> v_expected
     or coalesce(array_length(p_team_b, 1), 0) <> v_expected then
    raise exception 'A % match needs % player(s) per side.', p_match_type, v_expected
      using errcode = 'AR001';
  end if;

  v_all := p_team_a || p_team_b;

  if (select count(distinct u) from unnest(v_all) u) <> array_length(v_all, 1) then
    raise exception 'Each player can only hold one spot.' using errcode = 'AR001';
  end if;

  if not (v_caller = any(v_all)) then
    raise exception 'You have to be in the match to start it.' using errcode = 'AR001';
  end if;

  -- Pairwise across every named player, not just caller-vs-others: the
  -- caller assembles BOTH sides, so two other players who've blocked each
  -- other must also be caught. Deliberately generic message, no matter
  -- which pair or direction — this must never become a way to learn who
  -- blocked whom.
  if exists (
    select 1
    from unnest(v_all) a
    cross join unnest(v_all) b
    where a <> b
      and exists (
        select 1 from public.user_blocks
        where blocker_id = a and blocked_id = b
      )
  ) then
    raise exception 'One of these players can''t be matched together.' using errcode = 'AR001';
  end if;

  foreach v_user_id in array v_all loop
    perform public.ensure_player_rank(v_user_id, p_match_type);
  end loop;

  v_spread := public.ranked_party_spread(v_all, p_match_type);
  if v_spread > c_max_party_spread then
    raise exception 'Party rating difference too large — ranked parties must stay within % AAR of each other.', c_max_party_spread
      using errcode = 'AR001';
  end if;

  if p_court_id is not null then
    select venue_id into v_venue_id from public.courts where id = p_court_id;
  end if;

  insert into public.ranked_matches (season_id, event_id, court_id, venue_id, match_type, created_by)
  values (v_season, p_event_id, p_court_id, v_venue_id, p_match_type, v_caller)
  returning id into v_match_id;

  insert into public.ranked_match_players (match_id, user_id, team, is_host, mode)
  select v_match_id, u, 'a', u = v_caller, p_match_type from unnest(p_team_a) u
  union all
  select v_match_id, u, 'b', u = v_caller, p_match_type from unnest(p_team_b) u;

  insert into public.notifications (user_id, type, title, message, link_url)
  select u, 'ranked_match_found', 'Ranked match found',
         initcap(p_match_type) || ' — tap to ready up.',
         '/ranked/match/' || v_match_id
  from unnest(v_all) u
  where u <> v_caller;

  return v_match_id;
end;
$$;

revoke execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid) from public, anon;
grant execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid) to authenticated;
