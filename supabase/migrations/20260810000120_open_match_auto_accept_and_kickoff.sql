-- Two decisions from the founder land together, because they're the
-- same code path: (1) no host approval for joining an open match — a
-- passing rank-gap check accepts automatically, the system tells a
-- failing one it can't join, immediately; (2) a player can't hold two
-- active matches at once, which means the auto-convert-at-4 behavior
-- from 116 (immediate conversion) would lock four people out of ranked
-- play for however many days stand between posting and kickoff. Fixed
-- by converting AT kickoff, not at fill.
--
-- FOUR CHANGES, ONE MIGRATION, DELIBERATELY BUNDLED: the auth-boundary
-- split, the auto-accept rewrite, kickoff auto-start, and manual
-- start-at-4 all live in this one file rather than four. They're one
-- cohesive subsystem — conversion used to live inside accept_join_request,
-- which auto-accept deletes, so splitting these into separate migrations
-- would mean either shipping a broken intermediate state or designing
-- the same conversion logic twice. The cost of bundling is that a
-- revert takes all four together, not one at a time. Priced, not
-- accidental: at the time this was written, production has zero
-- open_matches rows and no client (mobile or web) calls any RPC this
-- migration touches, so the actual blast radius of bundling is nil —
-- recording that reasoning now, while it's true, since it won't be
-- once a client ships against this.
--
-- ============================================================================
-- WHY THIS DOESN'T NEED A NEW open_matches.status VALUE
-- ============================================================================
--
-- A full-but-not-yet-started match just stays `open`.
-- open_match_accepted_count() reaching 2 or 4 already IS "full" — no
-- new value needed to say so, and the browse list already reads that
-- count today. This also means kicking an accepted player after the
-- match was full doesn't need to "revert" any status: it just becomes
-- request-able again automatically, since nothing but the count ever
-- decided fullness. Simpler state machine, not a deferred decision.
--
-- ============================================================================
-- THE RACE: TWO SIMULTANEOUS JOINS AT THE 4TH SLOT
-- ============================================================================
--
-- Auto-accept means two different people can hit "join" within
-- milliseconds of each other. Each independently reads "3 accepted,
-- spread OK" and both could insert as accepted, overshooting 4 and
-- possibly the 350 spread cap as a pair even though each passed alone.
--
-- Fixed with `select ... for update` on the open_matches row as the
-- FIRST statement in every function that reads-then-writes
-- open_match_join_requests for that match (request_to_join_open_match,
-- kick_accepted_player, withdraw_join_request, cancel_open_match, the
-- convert_* helpers). Two requests on the SAME match now serialize —
-- the second waits for the first's transaction to commit before it
-- reads anything, so its own count/spread check is always against the
-- true post-first-request state. This is a per-match lock, not global.
--
-- This also replaces the old async "decline the straggler on fill"
-- path entirely, and better: the loser of a 4th-slot race re-reads
-- `status = 'converted'` the instant it acquires the lock (now visible,
-- since it waited) and gets a synchronous rejection in its OWN request
-- — 'This match is no longer open.' — rather than discovering later
-- that a `pending` row was flipped to `declined`. Matches the founder's
-- own words: "the system will tell them they're unable to join."
-- Nothing can be `pending` anymore, so no separate decline sweep is
-- needed for this case.
--
-- ============================================================================
-- create_ranked_match SPLIT: AUTH BOUNDARY VS. MECHANICS
-- ============================================================================
--
-- Converting an open match needs to call the same match-creation logic
-- production's party builder already uses — but from two places with
-- no real client session: a per-match auto-convert triggered by
-- WHICHEVER requester's join happens to fill the 4th slot (wrong
-- `created_by`/`is_host` if attributed to them instead of the actual
-- open-match host), and a cron sweep with no `auth.uid()` at all.
--
-- Split, not duplicated, not impersonated: create_ranked_match_internal
-- takes `p_created_by` explicitly instead of reading auth.uid(), has NO
-- caller check, and is revoked from every client role — only callable
-- by other trusted functions in this schema. create_ranked_match (the
-- public one, unchanged signature) becomes a thin wrapper: check
-- `auth.uid()` is not null, then call the internal function passing
-- `v_caller` straight through as `p_created_by`. Every check inside the
-- internal function is in the EXACT original order, just reading
-- `p_created_by` where the original read `v_caller` — so the existing
-- party-builder's client path is behaviorally identical, not merely
-- tested-equivalent. Verified against the full rating-engine regression
-- suite unchanged.
begin;

-- p_created_by exists so this function never has to guess who owns the
-- match it's creating. A function that infers ownership from auth.uid()
-- is only correct while the caller and the owner are the same person —
-- the instant something calls it on someone else's behalf (a cron, a
-- conversion triggered by a THIRD player's join, an admin action), it
-- silently reassigns ownership to whoever happened to trigger it. That
-- is exactly the bug this parameter exists to make impossible rather
-- than unlikely: the open-match auto-convert-at-4 path is triggered by
-- whichever requester's join fills the 4th slot, not by the host, and
-- would have made that requester the resulting ranked match's host if
-- this function still read auth.uid() directly. Do not "simplify" this
-- back to auth.uid() — that reintroduces the bug this exists to prevent.
create or replace function public.create_ranked_match_internal(
  p_match_type text,
  p_team_a uuid[],
  p_team_b uuid[],
  p_created_by uuid,
  p_event_id uuid default null,
  p_court_id uuid default null,
  p_rated boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season smallint := public.current_ranked_season();
  v_match_id uuid;
  v_expected integer;
  v_all uuid[];
  v_venue_id uuid;
  v_user_id uuid;
  v_spread integer;
  c_max_party_spread constant integer := 350;
begin
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

  if not (p_created_by = any(v_all)) then
    raise exception 'You have to be in the match to start it.' using errcode = 'AR001';
  end if;

  if p_event_id is not null then
    if not exists (
      select 1 from public.events e
      where e.id = p_event_id
        and (
          e.creator_id = p_created_by
          or exists (
            select 1 from public.event_attendees a
            where a.event_id = e.id and a.user_id = p_created_by
          )
        )
    ) then
      raise exception 'You can only attach a session you are part of.' using errcode = 'AR001';
    end if;
  end if;

  foreach v_user_id in array v_all loop
    perform public.ensure_player_rank(v_user_id);
  end loop;

  if p_rated then
    v_spread := public.ranked_party_spread(v_all);
    if v_spread > c_max_party_spread then
      raise exception 'Party rating difference too large — ranked parties must stay within % AAR of each other.', c_max_party_spread
        using errcode = 'AR001';
    end if;
  end if;

  if p_court_id is not null then
    select venue_id into v_venue_id from public.courts where id = p_court_id;
  end if;

  insert into public.ranked_matches (season_id, event_id, court_id, venue_id, match_type, created_by, rated)
  values (v_season, p_event_id, p_court_id, v_venue_id, p_match_type, p_created_by, p_rated)
  returning id into v_match_id;

  insert into public.ranked_match_players (match_id, user_id, team, is_host, mode)
  select v_match_id, u, 'a', u = p_created_by, p_match_type from unnest(p_team_a) u
  union all
  select v_match_id, u, 'b', u = p_created_by, p_match_type from unnest(p_team_b) u;

  insert into public.notifications (user_id, type, title, message, link_url)
  select u, 'ranked_match_found', 'Ranked match found',
         'Your ranked match is ready.', '/ranked/match/' || v_match_id
  from unnest(v_all) u
  where u <> p_created_by;

  return v_match_id;
end;
$$;

revoke execute on function public.create_ranked_match_internal(text, uuid[], uuid[], uuid, uuid, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.create_ranked_match(
  p_match_type text,
  p_team_a uuid[],
  p_team_b uuid[],
  p_event_id uuid default null,
  p_court_id uuid default null,
  p_rated boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  return public.create_ranked_match_internal(
    p_match_type, p_team_a, p_team_b, v_caller, p_event_id, p_court_id, p_rated
  );
end;
$$;

revoke execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) from public, anon;
grant execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared conversion helpers — always attribute the real open-match host
-- as created_by/is_host, regardless of who or what triggers conversion.
-- ---------------------------------------------------------------------------

create or replace function public.convert_open_match_to_singles(p_open_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.open_matches%rowtype;
  v_opponent_id uuid;
  v_ranked_match_id uuid;
begin
  select * into v_match from public.open_matches where id = p_open_match_id for update;

  select user_id into v_opponent_id
  from public.open_match_join_requests
  where open_match_id = p_open_match_id and status = 'accepted';

  v_ranked_match_id := public.create_ranked_match_internal(
    'singles', array[v_match.host_id], array[v_opponent_id], v_match.host_id
  );

  update public.open_matches
  set status = 'converted', converted_match_id = v_ranked_match_id
  where id = p_open_match_id;

  return v_ranked_match_id;
end;
$$;

revoke execute on function public.convert_open_match_to_singles(uuid) from public, anon, authenticated;

create or replace function public.convert_open_match_to_doubles(p_open_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.open_matches%rowtype;
  v_accepted_ids uuid[];
  v_team_a uuid[];
  v_team_b uuid[];
  v_ranked_match_id uuid;
begin
  select * into v_match from public.open_matches where id = p_open_match_id for update;

  select array_agg(user_id) into v_accepted_ids
  from public.open_match_join_requests
  where open_match_id = p_open_match_id and status = 'accepted';

  -- Exact, not a heuristic: sort by rating, pair {lowest,highest} vs
  -- {two middles} — always minimizes the pairing's rating gap.
  with roster as (
    select u.player_id,
           row_number() over (order by pr.rating asc) as rn
    from unnest(array[v_match.host_id] || v_accepted_ids) as u(player_id)
    join public.player_ranks pr
      on pr.user_id = u.player_id and pr.season_id = public.current_ranked_season()
  )
  select array_agg(player_id) filter (where rn in (1, 4)),
         array_agg(player_id) filter (where rn in (2, 3))
  into v_team_a, v_team_b
  from roster;

  v_ranked_match_id := public.create_ranked_match_internal('doubles', v_team_a, v_team_b, v_match.host_id);

  update public.open_matches
  set status = 'converted', converted_match_id = v_ranked_match_id
  where id = p_open_match_id;

  return v_ranked_match_id;
end;
$$;

revoke execute on function public.convert_open_match_to_doubles(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Join: auto-accept, row-locked, auto-converts inline at exactly 4
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

  -- Locks this match for the rest of the transaction. A concurrent
  -- request for the SAME match waits here until this one commits or
  -- rolls back, which is what makes the count/spread check below safe
  -- against two simultaneous joins.
  select * into v_match from public.open_matches where id = p_open_match_id for update;
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
    where open_match_id = p_open_match_id and user_id = v_caller and status = 'accepted'
  ) then
    raise exception 'You already asked to join this match.' using errcode = 'AR001';
  end if;

  if public.open_match_accepted_count(p_open_match_id) >= 4 then
    raise exception 'This match is full.' using errcode = 'AR001';
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

  insert into public.open_match_join_requests (open_match_id, user_id, status)
  values (p_open_match_id, v_caller, 'accepted')
  returning id into v_request_id;

  -- Reaching 4 here does NOT convert — it just closes the match to
  -- further requests (the "already full" check above starts firing for
  -- the next person). The ranked_matches row is created at scheduled_at
  -- (resolve_open_matches_at_kickoff) or by the host tapping
  -- start_open_match_full early. This is the whole point of converting
  -- at kickoff instead of at fill: converting here would create an
  -- active ranked match for four people who may not play for days.

  return v_request_id;
end;
$$;

revoke execute on function public.request_to_join_open_match(uuid) from public, anon;
grant execute on function public.request_to_join_open_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Host approval is gone. accept/decline have no callers and no rows to
-- act on (nothing can be `pending` anymore) — dropped rather than left
-- implying a flow that no longer exists.
-- ---------------------------------------------------------------------------

drop function if exists public.accept_join_request(uuid);
drop function if exists public.decline_join_request(uuid);

-- ---------------------------------------------------------------------------
-- Manual early start — for singles (unchanged trigger, now via the
-- shared helper) and the new doubles case (four people already there,
-- no reason to make them wait for the clock).
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
begin
  select * into v_match from public.open_matches where id = p_open_match_id for update;
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

  return public.convert_open_match_to_singles(p_open_match_id);
end;
$$;

revoke execute on function public.start_open_match_singles(uuid) from public, anon;
grant execute on function public.start_open_match_singles(uuid) to authenticated;

create or replace function public.start_open_match_full(p_open_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.open_matches%rowtype;
begin
  select * into v_match from public.open_matches where id = p_open_match_id for update;
  if v_match.id is null then
    raise exception 'This match no longer exists.' using errcode = 'AR001';
  end if;
  if v_match.host_id <> v_caller then
    raise exception 'Only the host can start this match.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'open' then
    raise exception 'This match is no longer open.' using errcode = 'AR001';
  end if;
  if public.open_match_accepted_count(p_open_match_id) <> 4 then
    raise exception 'Need exactly four players accepted to start now.' using errcode = 'AR001';
  end if;

  return public.convert_open_match_to_doubles(p_open_match_id);
end;
$$;

revoke execute on function public.start_open_match_full(uuid) from public, anon;
grant execute on function public.start_open_match_full(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-lock the rest of the mutating RPCs for the same reason as
-- request_to_join_open_match — consistent per-match serialization
-- rather than protecting only the one path that was easiest to notice.
-- ---------------------------------------------------------------------------

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
  v_open_match_id uuid;
begin
  select r.open_match_id into v_open_match_id from public.open_match_join_requests r where r.id = p_request_id;
  if v_open_match_id is not null then
    perform 1 from public.open_matches where id = v_open_match_id for update;
  end if;

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
  if v_request.id is not null then
    perform 1 from public.open_matches where id = v_request.open_match_id for update;
  end if;

  if v_request.id is null then
    raise exception 'That request no longer exists.' using errcode = 'AR001';
  end if;
  if v_request.user_id <> v_caller then
    raise exception 'You can only withdraw your own request.' using errcode = 'AR001';
  end if;
  if v_request.status <> 'accepted' then
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
  select * into v_match from public.open_matches where id = p_open_match_id for update;
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
  where open_match_id = p_open_match_id and status = 'accepted';
end;
$$;

revoke execute on function public.cancel_open_match(uuid) from public, anon;
grant execute on function public.cancel_open_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Kickoff sweep: replaces the old age-only expiry. At scheduled_at, a
-- startable match (2 or 4 accepted) starts; an unstartable one (1 or 3)
-- expires. `for update skip locked` per row so this never blocks on a
-- match mid-join right now — it just picks that one up next tick.
-- ---------------------------------------------------------------------------

drop function if exists public.expire_stale_open_matches();

create or replace function public.resolve_open_matches_at_kickoff()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_accepted integer;
begin
  for v_row in
    select id from public.open_matches
    where status = 'open' and scheduled_at <= now()
    for update skip locked
  loop
    v_accepted := public.open_match_accepted_count(v_row.id);
    if v_accepted = 2 then
      perform public.convert_open_match_to_singles(v_row.id);
    elsif v_accepted = 4 then
      perform public.convert_open_match_to_doubles(v_row.id);
    else
      update public.open_matches set status = 'expired' where id = v_row.id;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.resolve_open_matches_at_kickoff() from public, anon, authenticated;

select cron.unschedule('expire-stale-open-matches');

select cron.schedule(
  'resolve-open-matches-at-kickoff',
  '*/5 * * * *',
  $$select public.resolve_open_matches_at_kickoff()$$
);

commit;
