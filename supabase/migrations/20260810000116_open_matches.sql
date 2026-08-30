-- Open Match: a host broadcasts to same-city players and accepts who
-- joins, instead of every ranked match needing a pre-assembled roster.
-- Founder-approved and prioritized 2026-08-30 (open-match-design memory)
-- to fix launch day's real failure mode: 13 signups, zero matches,
-- because a lone player had nothing to do.
--
-- ============================================================================
-- WHY THIS IS ITS OWN TABLE PAIR, NOT A ranked_matches STATUS
-- ============================================================================
--
-- create_ranked_match() takes a COMPLETE roster and produces a match ready
-- to play — every downstream piece (RLS, the live scoreboard, the rating
-- engine, this week's side-out hardening) assumes that. An open match
-- starts with ONE player and an unknown eventual roster. Bolting that onto
-- ranked_matches' status enum would mean every one of those pieces newly
-- has to reason about "is this row even fillable yet", for zero benefit —
-- nothing about scoring or rating cares how a roster was assembled.
--
-- The two systems meet at exactly one call: once exactly 2 or exactly 4
-- players are accepted, this converts by calling the EXISTING
-- create_ranked_match() unchanged. Everything built this week stays
-- untouched.
--
-- ============================================================================
-- STATE MACHINE
-- ============================================================================
--
-- open_matches.status:
--   open       broadcasting. Covers 1 (host only) / 2 / 3 accepted.
--   converted  hit 2 (host started singles) or 4 (auto-converted).
--   expired    swept by expire_stale_open_matches() after 1 hour untouched.
--   cancelled  the host called it off.
--
-- open_match_join_requests.status:
--   pending    awaiting the host's decision.
--   accepted   host said yes. Counts toward the 2/4 thresholds.
--   declined   host said no (or the match filled/expired/was cancelled
--              while this request was still pending — the client tells
--              those apart by reading the PARENT match's status, not a
--              separate reason column: "converted" + "declined" reads as
--              "this match is full", "expired"/"cancelled" reads as
--              exactly that, anything else is a plain decline).
--   withdrawn  the requester's own action.
--   kicked     host removed an already-ACCEPTED request — distinct from
--              "declined" so the history shows they WERE in.
--
-- No row for the host in open_match_join_requests — host_id is the
-- source of truth on open_matches itself. "Accepted headcount" is
-- therefore always (1 + count of accepted requests), computed by
-- open_match_accepted_count() below rather than duplicated at each
-- call site.
--
-- At exactly 3 accepted, no finalizing action is possible — enforced
-- structurally, not with an extra check: start_open_match_singles()
-- only succeeds at exactly 2, and auto-conversion only fires at exactly
-- 4. The host's only moves at 3 are kick one (-> 2, can start) or wait
-- for a 4th (-> 4, auto-converts). There is no explicit "start doubles"
-- action to guard, because 4 always converts immediately — that is what
-- makes "this match is full" on the 4th request a guarantee, not a race.
--
-- ============================================================================
-- TEAM ASSIGNMENT AT 4 — EXACT, NOT A HEURISTIC
-- ============================================================================
--
-- Sort the four ratings ascending; {lowest, highest} vs {the two middles}
-- always minimizes the pairing's rating gap (verified numerically against
-- the open-match-design memory's own example: 1000/1100/1200/1400 gives
-- that pairing a 100-point gap against 300 and 500 for the alternatives).
-- No branch needed for uncalibrated players — everyone already has a
-- real numeric rating (default 1000) the moment ensure_player_rank runs,
-- which happens here at request-to-join time, same as visiting Ranked
-- today. All-uncalibrated (today's actual production population) still
-- runs the algorithm correctly; it just has no signal to act on.
--
-- ============================================================================
-- WHY THIS DOES NOT INTRODUCE A NEW RANK-GAP NUMBER LIGHTLY
-- ============================================================================
--
-- ranked_party_spread(uuid[]) is called UNCHANGED, at join-REQUEST time,
-- against the hypothetical roster (current accepted + the would-be
-- joiner) — per the design memory's own confirmation that the function
-- already returns 0 (never errors) when nobody involved is calibrated,
-- which is exactly what lets today's all-uncalibrated population play at
-- all. The cap here is 350, not create_ranked_match's separate 3-tier
-- check at final conversion — two different guards on two different
-- metrics that already coexist in production; this does not touch either.
--
begin;

create table public.open_matches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  target_city text not null references public.cities (slug),
  status text not null default 'open'
    check (status in ('open', 'converted', 'expired', 'cancelled')),
  converted_match_id uuid references public.ranked_matches (id),
  created_at timestamptz not null default now()
);

create index open_matches_browse_idx on public.open_matches (target_city, status, created_at desc);
create index open_matches_host_idx on public.open_matches (host_id, created_at desc);

create table public.open_match_join_requests (
  id uuid primary key default gen_random_uuid(),
  open_match_id uuid not null references public.open_matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'kicked')),
  created_at timestamptz not null default now()
);

-- Deliberately no unique constraint on (open_match_id, user_id): a
-- withdrawn or declined player may legitimately try again (a decline
-- isn't a permanent ban, and the design doc never says it should be).
-- Each RPC below checks for an already-ACTIVE (pending/accepted) row
-- itself instead.
create index open_match_join_requests_match_idx on public.open_match_join_requests (open_match_id, status);
create index open_match_join_requests_user_idx on public.open_match_join_requests (user_id, created_at desc);

alter table public.open_matches enable row level security;
alter table public.open_match_join_requests enable row level security;

-- Same recursion hazard, same fix, as ranked_matches/ranked_match_players
-- (20260810000067): "is this open match visible" depends on
-- open_match_join_requests, and "is this request visible" depends on
-- open_matches — a plain correlated subquery in each policy would be
-- circular (42P17). SECURITY DEFINER functions break the cycle.
create or replace function public.is_open_match_participant(p_open_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.open_match_join_requests
    where open_match_id = p_open_match_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_open_match_participant(uuid) to authenticated;

-- Single source of truth for "how many are in so far", including the
-- host — used by the RPCs below to decide 2/3/4, and by the browse list
-- so a non-participant can see a headcount without being able to query
-- open_match_join_requests directly (that table's own RLS below only
-- lets the host see every request and a requester see their own).
create or replace function public.open_match_accepted_count(p_open_match_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 1 + count(*)::integer
  from public.open_match_join_requests
  where open_match_id = p_open_match_id and status = 'accepted';
$$;

grant execute on function public.open_match_accepted_count(uuid) to authenticated;

create policy "Host, participants and same-city browsers can view open matches"
on public.open_matches for select
to authenticated
using (
  host_id = auth.uid()
  or public.is_open_match_participant(id)
  or (
    status = 'open'
    and target_city = (select p.city_slug from public.profiles p where p.id = auth.uid())
  )
  or public.is_admin()
);

create policy "Host sees every request, requester sees their own"
on public.open_match_join_requests for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.open_matches m
    where m.id = open_match_id and m.host_id = auth.uid()
  )
  or public.is_admin()
);

-- No insert/update/delete policy on either table, for any client role —
-- same pattern as ranked_matches. All writes go through the RPCs below,
-- which do the authorization and state-machine checks a bare policy
-- cannot express (host-only accept, exactly-2/exactly-4 thresholds,
-- the rank-gap check, the city check).

-- ---------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------

create or replace function public.create_open_match(p_city_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_open_match_id uuid;
  v_host_name text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  if not exists (select 1 from public.cities where slug = p_city_slug) then
    raise exception 'Pick a valid city.' using errcode = 'AR001';
  end if;

  perform public.ensure_player_rank(v_caller);

  -- The city picked here IS the player's registered city going forward —
  -- "ask inside the Find Match flow", not a per-match-only value. Per
  -- the design memory this is PERMANENT: a later device-location signal
  -- only pre-fills the ask, it never silently overwrites this column.
  update public.profiles set city_slug = p_city_slug where id = v_caller;

  insert into public.open_matches (host_id, target_city)
  values (v_caller, p_city_slug)
  returning id into v_open_match_id;

  select display_name into v_host_name from public.profiles where id = v_caller;

  -- One broadcast, sent once, to every other player registered in this
  -- city. "One notification per player" is satisfied by never
  -- re-sending, not by a dedupe check — expire_stale_open_matches()
  -- below does not repeat this.
  --
  -- THIS SCALES LINEARLY WITH CITY POPULATION, ON PURPOSE — that is the
  -- feature. It is currently safe only because the email webhook has no
  -- ranked-type eligible today (measured 2026-08-30: 95 calls, all
  -- `emailed:false`) and push no-ops per recipient with no device token
  -- (see notification-paths-have-asymmetric-guards memory). The day
  -- 'open_match_found' — or any ranked type — becomes email-eligible,
  -- every create_open_match() call becomes a mail-out to a whole city.
  -- That flag will be flipped somewhere else entirely (the webhook's own
  -- eligibility list), by someone who has no reason to read this RPC
  -- first. If you are that person: this is the trigger, not the victim.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.id, 'open_match_found', 'Open match near you',
         coalesce(v_host_name, 'Someone') || ' is looking for players — tap to join.',
         '/ranked/open/' || v_open_match_id
  from public.profiles p
  where p.city_slug = p_city_slug and p.id <> v_caller;

  return v_open_match_id;
end;
$$;

revoke execute on function public.create_open_match(text) from public, anon;
grant execute on function public.create_open_match(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Request to join
-- ---------------------------------------------------------------------------

create or replace function public.request_to_join_open_match(p_open_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.open_matches%rowtype;
  v_caller_city text;
  v_accepted_ids uuid[];
  v_request_id uuid;
  v_spread integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  select * into v_match from public.open_matches where id = p_open_match_id;
  if v_match.id is null then
    raise exception 'This match no longer exists.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;
  if v_match.host_id = v_caller then
    raise exception 'You are already hosting this match.' using errcode = 'AR001';
  end if;

  if exists (
    select 1 from public.open_match_join_requests
    where open_match_id = p_open_match_id and user_id = v_caller
      and status in ('pending', 'accepted')
  ) then
    raise exception 'You already asked to join this match.' using errcode = 'AR001';
  end if;

  -- Checked against the requester's OWN registered city, never trusted
  -- from how they arrived at this screen — a shared deep link cannot
  -- let someone outside the city cohort in.
  select city_slug into v_caller_city from public.profiles where id = v_caller;
  if v_caller_city is distinct from v_match.target_city then
    raise exception 'This match is for a different city.' using errcode = 'AR001';
  end if;

  perform public.ensure_player_rank(v_caller);

  select array_agg(user_id) into v_accepted_ids
  from public.open_match_join_requests
  where open_match_id = p_open_match_id and status = 'accepted';

  v_spread := public.ranked_party_spread(
    coalesce(v_accepted_ids, '{}') || array[v_match.host_id, v_caller]
  );
  if v_spread > 350 then
    raise exception 'You cannot party/play with this player, rank gap is too high.'
      using errcode = 'AR001';
  end if;

  insert into public.open_match_join_requests (open_match_id, user_id)
  values (p_open_match_id, v_caller)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function public.request_to_join_open_match(uuid) from public, anon;
grant execute on function public.request_to_join_open_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Host decisions: accept (with auto-convert at 4), decline, kick, cancel
-- ---------------------------------------------------------------------------

create or replace function public.accept_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.open_match_join_requests%rowtype;
  v_match public.open_matches%rowtype;
  v_count integer;
  v_accepted_ids uuid[];
  v_team_a uuid[];
  v_team_b uuid[];
  v_ranked_match_id uuid;
begin
  select * into v_request from public.open_match_join_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'That request no longer exists.' using errcode = 'AR001';
  end if;

  select * into v_match from public.open_matches where id = v_request.open_match_id;
  if v_match.host_id <> v_caller then
    raise exception 'Only the host can accept a request.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That request has already been decided.' using errcode = 'AR001';
  end if;

  update public.open_match_join_requests set status = 'accepted' where id = p_request_id;

  v_count := public.open_match_accepted_count(v_match.id);
  if v_count < 4 then
    return;
  end if;

  -- Exactly 4: auto-convert immediately, no host confirmation — there is
  -- no reason to wait past the natural ceiling, and it is what makes
  -- "this match is full" a guarantee rather than a race.
  select array_agg(user_id) into v_accepted_ids
  from public.open_match_join_requests
  where open_match_id = v_match.id and status = 'accepted';

  with roster as (
    select pr.user_id,
           row_number() over (order by pr.rating asc) as rn
    from public.player_ranks pr
    where pr.season_id = public.current_ranked_season()
      and pr.user_id = any(array[v_match.host_id] || v_accepted_ids)
  )
  select array_agg(user_id) filter (where rn in (1, 4)),
         array_agg(user_id) filter (where rn in (2, 3))
  into v_team_a, v_team_b
  from roster;

  v_ranked_match_id := public.create_ranked_match('doubles', v_team_a, v_team_b);

  update public.open_matches
  set status = 'converted', converted_match_id = v_ranked_match_id
  where id = v_match.id;

  -- Anyone still pending missed out because the match is now full — the
  -- client reads THIS distinctly from a plain decline by checking the
  -- parent match's status is 'converted'.
  update public.open_match_join_requests
  set status = 'declined'
  where open_match_id = v_match.id and status = 'pending';
end;
$$;

revoke execute on function public.accept_join_request(uuid) from public, anon;
grant execute on function public.accept_join_request(uuid) to authenticated;

create or replace function public.decline_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_host_id uuid;
begin
  -- A record variable (%rowtype) cannot share an INTO list with scalar
  -- columns from a second table, so this selects plain columns only.
  select r.status, m.host_id into v_status, v_host_id
  from public.open_match_join_requests r
  join public.open_matches m on m.id = r.open_match_id
  where r.id = p_request_id;

  if v_status is null then
    raise exception 'That request no longer exists.' using errcode = 'AR001';
  end if;
  if v_host_id <> v_caller then
    raise exception 'Only the host can decline a request.' using errcode = 'AR001';
  end if;
  if v_status <> 'pending' then
    raise exception 'That request has already been decided.' using errcode = 'AR001';
  end if;

  update public.open_match_join_requests set status = 'declined' where id = p_request_id;
end;
$$;

revoke execute on function public.decline_join_request(uuid) from public, anon;
grant execute on function public.decline_join_request(uuid) to authenticated;

create or replace function public.kick_accepted_player(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request_status text;
  v_host_id uuid;
  v_match_status text;
begin
  select r.status, m.host_id, m.status into v_request_status, v_host_id, v_match_status
  from public.open_match_join_requests r
  join public.open_matches m on m.id = r.open_match_id
  where r.id = p_request_id;

  if v_request_status is null then
    raise exception 'That request no longer exists.' using errcode = 'AR001';
  end if;
  if v_host_id <> v_caller then
    raise exception 'Only the host can remove a player.' using errcode = 'AR001';
  end if;
  if v_match_status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;
  if v_request_status <> 'accepted' then
    raise exception 'That player is not currently in the match.' using errcode = 'AR001';
  end if;

  update public.open_match_join_requests set status = 'kicked' where id = p_request_id;
end;
$$;

revoke execute on function public.kick_accepted_player(uuid) from public, anon;
grant execute on function public.kick_accepted_player(uuid) to authenticated;

create or replace function public.withdraw_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.open_match_join_requests%rowtype;
begin
  select * into v_request from public.open_match_join_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'That request no longer exists.' using errcode = 'AR001';
  end if;
  if v_request.user_id <> v_caller then
    raise exception 'You can only withdraw your own request.' using errcode = 'AR001';
  end if;
  if v_request.status not in ('pending', 'accepted') then
    raise exception 'That request is already settled.' using errcode = 'AR001';
  end if;

  update public.open_match_join_requests set status = 'withdrawn' where id = p_request_id;
end;
$$;

revoke execute on function public.withdraw_join_request(uuid) from public, anon;
grant execute on function public.withdraw_join_request(uuid) to authenticated;

create or replace function public.cancel_open_match(p_open_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.open_matches%rowtype;
begin
  select * into v_match from public.open_matches where id = p_open_match_id;
  if v_match.id is null then
    raise exception 'This match no longer exists.' using errcode = 'AR001';
  end if;
  if v_match.host_id <> v_caller then
    raise exception 'Only the host can cancel this match.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;

  update public.open_matches set status = 'cancelled' where id = p_open_match_id;

  update public.open_match_join_requests
  set status = 'declined'
  where open_match_id = p_open_match_id and status in ('pending', 'accepted');
end;
$$;

revoke execute on function public.cancel_open_match(uuid) from public, anon;
grant execute on function public.cancel_open_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Explicit start at exactly 2 (singles) — 4 always auto-converts inside
-- accept_join_request above, so there is no equivalent "start doubles".
-- ---------------------------------------------------------------------------

create or replace function public.start_open_match_singles(p_open_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.open_matches%rowtype;
  v_opponent_id uuid;
  v_ranked_match_id uuid;
begin
  select * into v_match from public.open_matches where id = p_open_match_id;
  if v_match.id is null then
    raise exception 'This match no longer exists.' using errcode = 'AR001';
  end if;
  if v_match.host_id <> v_caller then
    raise exception 'Only the host can start this match.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;
  if public.open_match_accepted_count(p_open_match_id) <> 2 then
    raise exception 'Need exactly one other player accepted to start singles.'
      using errcode = 'AR001';
  end if;

  select user_id into v_opponent_id
  from public.open_match_join_requests
  where open_match_id = p_open_match_id and status = 'accepted';

  v_ranked_match_id := public.create_ranked_match('singles', array[v_match.host_id], array[v_opponent_id]);

  update public.open_matches
  set status = 'converted', converted_match_id = v_ranked_match_id
  where id = p_open_match_id;

  return v_ranked_match_id;
end;
$$;

revoke execute on function public.start_open_match_singles(uuid) from public, anon;
grant execute on function public.start_open_match_singles(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Expiry — same shape as expire_stalled_ranked_matches() (114) and
-- expire-stale-paymongo-bookings.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_open_matches(p_open_minutes integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stale as (
    select id from public.open_matches
    where status = 'open' and created_at < now() - make_interval(mins => p_open_minutes)
  )
  update public.open_matches m
  set status = 'expired'
  from stale s
  where m.id = s.id;

  get diagnostics v_count = row_count;

  update public.open_match_join_requests r
  set status = 'declined'
  where r.status = 'pending'
    and exists (
      select 1 from public.open_matches m
      where m.id = r.open_match_id and m.status = 'expired'
    );

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_open_matches(integer) from public, anon, authenticated;

select cron.schedule(
  'expire-stale-open-matches',
  '*/15 * * * *',
  $$select public.expire_stale_open_matches()$$
);

commit;
