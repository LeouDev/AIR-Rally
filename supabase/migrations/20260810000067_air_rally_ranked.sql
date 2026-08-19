-- AIR/Rally Ranked — competitive doubles/singles with a visible tier ladder.
--
-- Two progressions run side by side, deliberately:
--
--   * AAR (`player_ranks.rating`) — a plain Elo number. It moves on every
--     confirmed match, it is what the leaderboard sorts on, and it is what
--     places a player when calibration ends. Opponent strength is the only
--     thing that scales it; score margin does NOT (an 11-4 win is not worth
--     more than an 11-8 one, because running up the score is not the
--     behaviour this product wants to reward).
--
--   * Tier + pips (`tier` 1..8, `pips` 0..5) — the visible ladder. A win is
--     +1 pip, a loss is -1, five pips puts you in a promotion series, and
--     zero pips plus a loss demotes you. This is what the badges show.
--
-- They are separate because they answer different questions. AAR answers
-- "who is actually better"; the pip ladder answers "did today go well",
-- which is the thing a recreational player feels. Collapsing them into one
-- number would make either the leaderboard mushy or the badge jumpy.
--
-- WRITES: no client role gets insert/update on any table here. Every
-- mutation goes through a SECURITY DEFINER function below, for the same
-- reason `notifications` does (20260810000024) — a ranked result is a
-- cross-user write by definition (four players' ratings move at once), and
-- row-scoped RLS can never express "this referee may write these four
-- players' rows, but only for this match, and only once".

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

-- Ranked resets periodically: pips and star protections are seasonal, AAR
-- carries a soft reset at the operator's discretion. One row per season,
-- exactly one current at a time.
create table public.ranked_seasons (
  id smallint primary key generated always as identity,
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Exactly one open season. A partial unique index rather than a boolean
-- flag, so "two current seasons" is unrepresentable rather than merely
-- discouraged.
create unique index ranked_seasons_one_current_idx
  on public.ranked_seasons ((ended_at is null))
  where ended_at is null;

insert into public.ranked_seasons (name) values ('Season 1');

alter table public.ranked_seasons enable row level security;

create policy "Seasons are public"
on public.ranked_seasons for select
using (true);

create or replace function public.current_ranked_season()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select id from public.ranked_seasons where ended_at is null limit 1;
$$;

grant execute on function public.current_ranked_season() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ladder constants
-- ---------------------------------------------------------------------------

-- Tier names live in TypeScript (lib/ranked.ts), not here. Postgres only
-- needs to know the ladder is 1..8 and how a rating maps onto it; naming
-- tier 5 "Ace" is presentation, and duplicating it would give it two homes.
--
-- Placement bands: base 1200, 100 AAR per tier. A player who finishes
-- calibration at the 1500 starting rating places at tier 4 — the middle of
-- an eight-rung ladder, which is the honest answer for someone whose ten
-- matches said "about average".
create or replace function public.ranked_tier_for_rating(p_rating integer)
returns smallint
language sql
immutable
as $$
  select greatest(1, least(8, 1 + ((p_rating - 1200) / 100)))::smallint;
$$;

-- ---------------------------------------------------------------------------
-- Per-player standing
-- ---------------------------------------------------------------------------

create table public.player_ranks (
  season_id smallint not null references public.ranked_seasons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Elo. Everyone starts at 1500; it is hidden from the player until
  -- calibration finishes, but it is moving the whole time.
  rating integer not null default 1500,

  -- The visible ladder. Both stay at their defaults and mean nothing until
  -- `is_calibrated` flips — see the calibration note below.
  tier smallint not null default 4 check (tier between 1 and 8),
  pips smallint not null default 0 check (pips between 0 and 5),

  -- True once the player has filled all five pips and needs one more win to
  -- promote. Stored rather than derived from `pips = 5` because it is the
  -- thing the UI announces ("promotion match"), and because a demotion out
  -- of a promotion series must clear it explicitly.
  in_promotion_series boolean not null default false,

  -- Spent automatically on a loss that would otherwise cost a pip. One is
  -- granted at the start of a season and one more on each promotion, capped
  -- at RANKED_MAX_STAR_PROTECTION (2) — see apply_ranked_result().
  star_protection smallint not null default 1 check (star_protection between 0 and 2),

  -- Placement: the first ten ranked matches move AAR at a high K and show
  -- no tier at all. Results still count — they are what places the player.
  calibration_matches integer not null default 0 check (calibration_matches >= 0),
  is_calibrated boolean not null default false,

  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  current_streak integer not null default 0,
  best_streak integer not null default 0 check (best_streak >= 0),

  -- High-water marks, for the "new best rank" moment. Null until calibrated.
  best_tier smallint check (best_tier between 1 and 8),
  best_pips smallint check (best_pips between 0 and 5),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season_id, user_id)
);

-- The leaderboard's only ordering, and the "where am I" lookup behind it.
create index player_ranks_season_rating_idx
  on public.player_ranks (season_id, rating desc, user_id)
  where is_calibrated;

alter table public.player_ranks enable row level security;

-- Standings are public — they are printed on profiles, the leaderboard and
-- every match lobby. Nothing here is private; a rating is the point.
create policy "Ranks are public"
on public.player_ranks for select
using (true);

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------

create table public.ranked_matches (
  id uuid primary key default gen_random_uuid(),
  season_id smallint not null references public.ranked_seasons (id),

  -- Where this was played. All optional: a ranked match is normally struck
  -- inside an Open Play session on a booked court, but the ladder does not
  -- require either — four people on any court can play one.
  event_id uuid references public.events (id) on delete set null,
  court_id uuid references public.courts (id) on delete set null,
  venue_id uuid references public.venues (id) on delete set null,

  match_type text not null check (match_type in ('singles', 'doubles')),

  -- lobby              — players invited, waiting on ready
  -- officiating        — everyone ready, agreeing who calls the score
  -- live               — points are being recorded
  -- awaiting_confirmation — final score submitted, players confirming
  -- confirmed          — everyone accepted; ratings applied, and final
  -- disputed           — someone objected; NOTHING is applied, ever, unless
  --                      an admin resolves it back to awaiting_confirmation
  -- cancelled          — abandoned before it counted
  status text not null default 'lobby'
    check (status in ('lobby', 'officiating', 'live', 'awaiting_confirmation', 'confirmed', 'disputed', 'cancelled')),

  -- Who calls the score. 'referee' is a fifth person who is not playing —
  -- the recommended arrangement. 'player_scorekeeper' is the fallback when
  -- no one is free courtside: one of the four keeps score, which every
  -- player has to agree to precisely because it is the weaker guarantee.
  officiating_mode text check (officiating_mode in ('referee', 'player_scorekeeper')),
  -- The person actually holding the scoreboard, under either mode.
  scorekeeper_id uuid references public.profiles (id) on delete set null,

  target_score smallint not null default 11 check (target_score between 7 and 21),
  win_by smallint not null default 2 check (win_by between 1 and 2),

  score_a smallint not null default 0 check (score_a >= 0),
  score_b smallint not null default 0 check (score_b >= 0),
  serving_team text not null default 'a' check (serving_team in ('a', 'b')),

  winning_team text check (winning_team in ('a', 'b')),

  -- Set once ratings have moved. The guard against a double-apply is this
  -- flag plus the row lock in apply_ranked_result(), not application code.
  rank_applied boolean not null default false,

  dispute_reason text,

  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index ranked_matches_event_idx on public.ranked_matches (event_id) where event_id is not null;
create index ranked_matches_status_idx on public.ranked_matches (status, created_at desc);

create table public.ranked_match_players (
  match_id uuid not null references public.ranked_matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team text not null check (team in ('a', 'b')),
  is_host boolean not null default false,

  ready boolean not null default false,
  ready_at timestamptz,

  -- Unanimity, twice over: once on who officiates, once on the final score.
  -- Both are null until the player has actually answered, so "hasn't voted"
  -- and "voted no" are different states rather than both reading as false.
  officiating_vote boolean,
  result_response text not null default 'pending'
    check (result_response in ('pending', 'accepted', 'disputed')),
  dispute_reason text,

  -- Frozen at the moment ratings applied. A match card months later shows
  -- what the result was worth THEN, not what today's numbers would imply.
  rating_before integer,
  rating_after integer,
  rating_delta integer,
  tier_before smallint,
  pips_before smallint,
  tier_after smallint,
  pips_after smallint,
  pip_delta smallint,
  star_protected boolean not null default false,

  created_at timestamptz not null default now(),

  primary key (match_id, user_id)
);

create index ranked_match_players_user_idx on public.ranked_match_players (user_id, created_at desc);

-- Every point, in order. The running score on `ranked_matches` is the
-- denormalised head of this list.
--
-- A log rather than just a counter because the scoreboard has UNDO, and
-- because the other three players watch the referee's device live over
-- Realtime — "the score went back one" has to be a real, ordered event
-- rather than a number that silently changed underneath them.
create table public.ranked_match_points (
  match_id uuid not null references public.ranked_matches (id) on delete cascade,
  seq integer not null check (seq > 0),
  team text not null check (team in ('a', 'b')),
  recorded_by uuid not null references public.profiles (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  primary key (match_id, seq)
);

alter table public.ranked_matches enable row level security;
alter table public.ranked_match_players enable row level security;
alter table public.ranked_match_points enable row level security;

-- Visibility: the people in the match, the person officiating it, and
-- admins. A confirmed match is additionally readable by anyone, because
-- it is match history — it shows on both players' public profiles.
--
-- Both halves of that rule need to read the OTHER table: "is this match
-- visible" depends on who's in ranked_match_players, and "is this match
-- membership row visible" depends on ranked_matches' status/scorekeeper.
-- A plain correlated subquery in each policy is a circular RLS reference
-- — evaluating ranked_matches' policy queries ranked_match_players,
-- which evaluates ITS policy by querying ranked_matches, forever
-- (Postgres error 42P17, infinite_recursion). SECURITY DEFINER functions
-- break the cycle the same way is_admin() already does for `profiles`:
-- they run as their owner, which bypasses RLS on the tables they touch
-- internally (these tables are never FORCE ROW LEVEL SECURITY'd), so
-- calling one from inside a policy does not re-trigger the callee
-- table's own RLS.
create or replace function public.is_ranked_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_ranked_match_participant(uuid) to authenticated;

create or replace function public.ranked_match_visible_to_caller(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ranked_matches m
    where m.id = p_match_id
      and (
        m.status = 'confirmed'
        or m.created_by = auth.uid()
        or m.scorekeeper_id = auth.uid()
        or public.is_ranked_match_participant(m.id)
      )
  );
$$;

grant execute on function public.ranked_match_visible_to_caller(uuid) to authenticated;

create policy "Participants and admins can view ranked matches"
on public.ranked_matches for select
using (
  status = 'confirmed'
  or created_by = auth.uid()
  or scorekeeper_id = auth.uid()
  or public.is_ranked_match_participant(id)
  or public.is_admin()
);

create policy "Participants and admins can view ranked match players"
on public.ranked_match_players for select
using (
  public.ranked_match_visible_to_caller(match_id) or public.is_admin()
);

create policy "Participants and admins can view ranked match points"
on public.ranked_match_points for select
using (
  public.ranked_match_visible_to_caller(match_id) or public.is_admin()
);

-- No insert/update/delete policy on any of the four tables above, for any
-- client role. See the header note.

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------

-- security_invoker so the view is subject to the caller's own policies on
-- the tables underneath, rather than the definer's — both are public here,
-- but a view that quietly runs as its owner is how a private column leaks
-- later when someone tightens the base table and forgets the view.
create view public.ranked_leaderboard
with (security_invoker = true)
as
select
  r.season_id,
  r.user_id,
  p.display_name,
  p.avatar_url,
  r.rating,
  r.tier,
  r.pips,
  r.wins,
  r.losses,
  rank() over (partition by r.season_id order by r.rating desc, r.user_id) as position
from public.player_ranks r
join public.public_profiles p on p.id = r.user_id
where r.is_calibrated;

grant select on public.ranked_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Standing bootstrap
-- ---------------------------------------------------------------------------

-- Idempotent "make sure this player has a standing for the open season".
-- Called on every write path rather than at signup, so the ranked tables
-- stay empty for the (large) majority of accounts that never play ranked.
create or replace function public.ensure_player_rank(p_user_id uuid)
returns public.player_ranks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season smallint := public.current_ranked_season();
  v_row public.player_ranks%rowtype;
begin
  if v_season is null then
    raise exception 'Ranked is between seasons right now.' using errcode = 'AR001';
  end if;

  insert into public.player_ranks (season_id, user_id)
  values (v_season, p_user_id)
  on conflict (season_id, user_id) do nothing;

  select * into v_row from public.player_ranks
  where season_id = v_season and user_id = p_user_id;

  return v_row;
end;
$$;

-- Internal: it takes an arbitrary user id because create_ranked_match has
-- to bootstrap every player in the party, not just the caller. That is
-- exactly why no client role may call it directly.
revoke execute on function public.ensure_player_rank(uuid) from public, anon, authenticated;

-- The client-reachable half: "give me a standing, mine only". Called the
-- first time a player opens Ranked, before they have played anything.
create or replace function public.ensure_my_player_rank()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;
  perform public.ensure_player_rank(auth.uid());
end;
$$;

revoke execute on function public.ensure_my_player_rank() from public, anon;
grant execute on function public.ensure_my_player_rank() to authenticated;

-- ---------------------------------------------------------------------------
-- Party eligibility
-- ---------------------------------------------------------------------------

-- A ranked party may span at most three tiers. Wider than that and the
-- match stops being a measurement: the Elo maths still works, but a Dinker
-- put on court with a Kitchen King has no path to a competitive rally, and
-- both players' ratings move on noise.
--
-- Uncalibrated players are exempt — they have no tier yet, and refusing
-- them a party would make the ten placement matches impossible to play.
create or replace function public.ranked_party_spread(p_user_ids uuid[])
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(tier) - min(tier), 0)
  from public.player_ranks
  where season_id = public.current_ranked_season()
    and user_id = any(p_user_ids)
    and is_calibrated;
$$;

grant execute on function public.ranked_party_spread(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a match
-- ---------------------------------------------------------------------------

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

  -- Nobody plays twice, including against themselves.
  if (select count(distinct u) from unnest(v_all) u) <> array_length(v_all, 1) then
    raise exception 'Each player can only hold one spot.' using errcode = 'AR001';
  end if;

  -- The caller has to be on court. Ranked matches are struck by a
  -- participant, never arranged for other people by a third party.
  if not (v_caller = any(v_all)) then
    raise exception 'You have to be in the match to start it.' using errcode = 'AR001';
  end if;

  -- Every player needs a standing before the spread can be read.
  foreach v_user_id in array v_all loop
    perform public.ensure_player_rank(v_user_id);
  end loop;

  v_spread := public.ranked_party_spread(v_all);
  if v_spread > 3 then
    raise exception 'Party rank difference too large — ranked parties span at most three tiers.'
      using errcode = 'AR001';
  end if;

  if p_court_id is not null then
    select venue_id into v_venue_id from public.courts where id = p_court_id;
  end if;

  insert into public.ranked_matches (season_id, event_id, court_id, venue_id, match_type, created_by)
  values (v_season, p_event_id, p_court_id, v_venue_id, p_match_type, v_caller)
  returning id into v_match_id;

  insert into public.ranked_match_players (match_id, user_id, team, is_host)
  select v_match_id, u, 'a', u = v_caller from unnest(p_team_a) u
  union all
  select v_match_id, u, 'b', u = v_caller from unnest(p_team_b) u;

  -- Everyone except the person who just pressed the button — they are
  -- looking at the lobby already.
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

-- ---------------------------------------------------------------------------
-- Lobby: ready up
-- ---------------------------------------------------------------------------

create or replace function public.set_ranked_ready(p_match_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_pending integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  select status into v_status from public.ranked_matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_status <> 'lobby' then
    raise exception 'This match has already left the lobby.' using errcode = 'AR001';
  end if;

  update public.ranked_match_players
  set ready = p_ready, ready_at = case when p_ready then now() else null end
  where match_id = p_match_id and user_id = v_caller;

  if not found then
    raise exception 'You are not in this match.' using errcode = 'AR001';
  end if;

  select count(*) into v_pending
  from public.ranked_match_players
  where match_id = p_match_id and not ready;

  if v_pending = 0 then
    update public.ranked_matches
    set status = 'officiating', updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

revoke execute on function public.set_ranked_ready(uuid, boolean) from public, anon;
grant execute on function public.set_ranked_ready(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Officiating: propose, then unanimous approval
-- ---------------------------------------------------------------------------

-- Proposing resets every vote, including the proposer's. Swapping the
-- scorekeeper after two people have agreed must not carry their agreement
-- over to a different person — they agreed to Bea, not to whoever comes
-- next.
create or replace function public.propose_ranked_officiating(
  p_match_id uuid,
  p_mode text,
  p_scorekeeper_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;
  if p_mode not in ('referee', 'player_scorekeeper') then
    raise exception 'Pick a referee or a player scorekeeper.' using errcode = 'AR001';
  end if;

  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'officiating' then
    raise exception 'Everyone has to be ready first.' using errcode = 'AR001';
  end if;
  if not exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = v_caller
  ) then
    raise exception 'You are not in this match.' using errcode = 'AR001';
  end if;

  -- A referee is by definition NOT playing; a player scorekeeper by
  -- definition is. Getting this backwards is the one way the arrangement
  -- stops meaning anything, so it is a constraint rather than a convention.
  if p_mode = 'referee' and exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = p_scorekeeper_id
  ) then
    raise exception 'A referee cannot be playing in the match.' using errcode = 'AR001';
  end if;
  if p_mode = 'player_scorekeeper' and not exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = p_scorekeeper_id
  ) then
    raise exception 'A player scorekeeper has to be one of the players.' using errcode = 'AR001';
  end if;

  update public.ranked_matches
  set officiating_mode = p_mode, scorekeeper_id = p_scorekeeper_id, updated_at = now()
  where id = p_match_id;

  update public.ranked_match_players
  set officiating_vote = null
  where match_id = p_match_id;
end;
$$;

revoke execute on function public.propose_ranked_officiating(uuid, text, uuid) from public, anon;
grant execute on function public.propose_ranked_officiating(uuid, text, uuid) to authenticated;

create or replace function public.vote_ranked_officiating(p_match_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
  v_outstanding integer;
  v_name text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'officiating' then
    raise exception 'There is nothing to approve right now.' using errcode = 'AR001';
  end if;
  if v_match.scorekeeper_id is null then
    raise exception 'Nobody has been proposed yet.' using errcode = 'AR001';
  end if;

  update public.ranked_match_players
  set officiating_vote = p_approve
  where match_id = p_match_id and user_id = v_caller;

  if not found then
    raise exception 'You are not in this match.' using errcode = 'AR001';
  end if;

  -- Unanimity: a single null (not answered) or false (objected) is enough
  -- to hold the match in `officiating`.
  select count(*) into v_outstanding
  from public.ranked_match_players
  where match_id = p_match_id and coalesce(officiating_vote, false) = false;

  if v_outstanding = 0 then
    update public.ranked_matches
    set status = 'live', started_at = now(), updated_at = now()
    where id = p_match_id;

    select coalesce(display_name, 'Your scorekeeper') into v_name
    from public.profiles where id = v_match.scorekeeper_id;

    insert into public.notifications (user_id, type, title, message, link_url)
    select p.user_id, 'ranked_officiating_confirmed', 'Match starting',
           v_name || ' is calling the score. Play ball.',
           '/ranked/match/' || p_match_id
    from public.ranked_match_players p
    where p.match_id = p_match_id;
  end if;
end;
$$;

revoke execute on function public.vote_ranked_officiating(uuid, boolean) from public, anon;
grant execute on function public.vote_ranked_officiating(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

create or replace function public.record_ranked_point(p_match_id uuid, p_team text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
  v_seq integer;
begin
  if p_team not in ('a', 'b') then
    raise exception 'Unknown team.' using errcode = 'AR001';
  end if;

  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'live' then
    raise exception 'This match is not in play.' using errcode = 'AR001';
  end if;
  if v_match.scorekeeper_id is distinct from v_caller then
    raise exception 'Only the scorekeeper can record points.' using errcode = 'AR001';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
  from public.ranked_match_points where match_id = p_match_id;

  insert into public.ranked_match_points (match_id, seq, team, recorded_by)
  values (p_match_id, v_seq, p_team, v_caller);

  -- Side out: whoever scored serves next. The scoreboard reads
  -- `serving_team` rather than recomputing it from the point log.
  update public.ranked_matches
  set score_a = score_a + (case when p_team = 'a' then 1 else 0 end),
      score_b = score_b + (case when p_team = 'b' then 1 else 0 end),
      serving_team = p_team,
      updated_at = now()
  where id = p_match_id;
end;
$$;

revoke execute on function public.record_ranked_point(uuid, text) from public, anon;
grant execute on function public.record_ranked_point(uuid, text) to authenticated;

create or replace function public.undo_ranked_point(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
  v_last public.ranked_match_points%rowtype;
  v_prev text;
begin
  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'live' then
    raise exception 'This match is not in play.' using errcode = 'AR001';
  end if;
  if v_match.scorekeeper_id is distinct from v_caller then
    raise exception 'Only the scorekeeper can undo a point.' using errcode = 'AR001';
  end if;

  select * into v_last from public.ranked_match_points
  where match_id = p_match_id order by seq desc limit 1;

  if v_last.match_id is null then
    return; -- Nothing to undo. Not an error — the button is just idle.
  end if;

  delete from public.ranked_match_points
  where match_id = p_match_id and seq = v_last.seq;

  -- Serve returns to whoever scored the point before the one just removed;
  -- at 0-0 it returns to team A, which is where the match opened.
  select team into v_prev from public.ranked_match_points
  where match_id = p_match_id order by seq desc limit 1;

  update public.ranked_matches
  set score_a = score_a - (case when v_last.team = 'a' then 1 else 0 end),
      score_b = score_b - (case when v_last.team = 'b' then 1 else 0 end),
      serving_team = coalesce(v_prev, 'a'),
      updated_at = now()
  where id = p_match_id;
end;
$$;

revoke execute on function public.undo_ranked_point(uuid) from public, anon;
grant execute on function public.undo_ranked_point(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Submitting the final score
-- ---------------------------------------------------------------------------

create or replace function public.submit_ranked_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
  v_winner text;
  v_high smallint;
  v_low smallint;
  v_name text;
begin
  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'live' then
    raise exception 'This match is not in play.' using errcode = 'AR001';
  end if;
  if v_match.scorekeeper_id is distinct from v_caller then
    raise exception 'Only the scorekeeper can submit the final score.' using errcode = 'AR001';
  end if;

  v_high := greatest(v_match.score_a, v_match.score_b);
  v_low := least(v_match.score_a, v_match.score_b);

  -- The same rule the players just played to, enforced rather than
  -- trusted: a game is over at the target AND clear by the win-by margin.
  if v_high < v_match.target_score or (v_high - v_low) < v_match.win_by then
    raise exception 'That score is not a finished game — first to %, win by %.',
      v_match.target_score, v_match.win_by using errcode = 'AR001';
  end if;

  v_winner := case when v_match.score_a > v_match.score_b then 'a' else 'b' end;

  update public.ranked_matches
  set status = 'awaiting_confirmation',
      winning_team = v_winner,
      completed_at = now(),
      updated_at = now()
  where id = p_match_id;

  -- The scorekeeper does not confirm their own submission — submitting IS
  -- their answer. Only a player who was not holding the scoreboard has
  -- something left to say.
  update public.ranked_match_players
  set result_response = 'accepted'
  where match_id = p_match_id and user_id = v_caller;

  select coalesce(display_name, 'The scorekeeper') into v_name
  from public.profiles where id = v_caller;

  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_result_submitted', 'Confirm the result',
         v_name || ' submitted ' || v_match.score_a || '–' || v_match.score_b || '. Accept or dispute.',
         '/ranked/match/' || p_match_id
  from public.ranked_match_players p
  where p.match_id = p_match_id and p.user_id <> v_caller;

  -- A singles match the scorekeeper played in can already be unanimous.
  perform public.apply_ranked_result_if_unanimous(p_match_id);
end;
$$;

revoke execute on function public.submit_ranked_result(uuid) from public, anon;
grant execute on function public.submit_ranked_result(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The rating engine
-- ---------------------------------------------------------------------------

-- Applies ratings for a match everyone has accepted. Internal: no grants,
-- reached only through the two callers below, both of which hold the match
-- row lock first. `rank_applied` plus that lock is what makes a
-- double-apply impossible even under concurrent confirmations.
create or replace function public.apply_ranked_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- One protection at the start of a season, one more per promotion, never
  -- more than this many banked at once.
  c_max_protection constant smallint := 2;
  c_calibration_matches constant integer := 10;

  v_match public.ranked_matches%rowtype;
  v_avg_a numeric;
  v_avg_b numeric;
  v_player record;
  v_rank public.player_ranks%rowtype;
  v_opponent_avg numeric;
  v_actual numeric;
  v_k integer;
  v_expected numeric;
  v_delta integer;
  v_new_rating integer;

  v_tier smallint;
  v_pips smallint;
  v_series boolean;
  v_protection smallint;
  v_pip_delta smallint;
  v_protected boolean;
  v_promoted boolean;
  v_demoted boolean;
  v_calibrated_now boolean;
  v_streak integer;
begin
  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null
     or v_match.rank_applied
     or v_match.winning_team is null
     or v_match.status <> 'awaiting_confirmation' then
    return;
  end if;

  -- Team strength is the plain mean of its players' ratings. In doubles
  -- that treats a pairing as one entity, which is what a doubles result
  -- actually measures — you cannot separate a partner's contribution from
  -- a single score line, and pretending otherwise would invent signal.
  select avg(pr.rating) into v_avg_a
  from public.ranked_match_players mp
  join public.player_ranks pr on pr.user_id = mp.user_id and pr.season_id = v_match.season_id
  where mp.match_id = p_match_id and mp.team = 'a';

  select avg(pr.rating) into v_avg_b
  from public.ranked_match_players mp
  join public.player_ranks pr on pr.user_id = mp.user_id and pr.season_id = v_match.season_id
  where mp.match_id = p_match_id and mp.team = 'b';

  -- Ordered by user_id, not left to the heap: two matches confirming at
  -- once can share a player, and every transaction taking these row locks
  -- in the same order is what makes that a wait rather than a deadlock.
  for v_player in
    select user_id, team from public.ranked_match_players
    where match_id = p_match_id
    order by user_id
  loop
    -- Belt and braces — create_ranked_match() already bootstrapped every
    -- player, but a null standing here would silently write a null rating.
    perform public.ensure_player_rank(v_player.user_id);

    select * into v_rank from public.player_ranks
    where season_id = v_match.season_id and user_id = v_player.user_id
    for update;

    v_opponent_avg := case when v_player.team = 'a' then v_avg_b else v_avg_a end;
    v_actual := case when v_player.team = v_match.winning_team then 1 else 0 end;

    -- K falls as the ladder gets thinner: placement moves fast, the top
    -- moves slowly, so a Rally Legend's number is a long average rather
    -- than a record of their last afternoon.
    v_k := case
      when not v_rank.is_calibrated then 40
      when v_rank.tier >= 6 then 24
      else 32
    end;

    v_expected := 1.0 / (1.0 + power(10.0, (v_opponent_avg - v_rank.rating) / 400.0));
    v_delta := round(v_k * (v_actual - v_expected));
    v_new_rating := v_rank.rating + v_delta;

    v_tier := v_rank.tier;
    v_pips := v_rank.pips;
    v_series := v_rank.in_promotion_series;
    v_protection := v_rank.star_protection;
    v_pip_delta := 0;
    v_protected := false;
    v_promoted := false;
    v_demoted := false;
    v_calibrated_now := false;

    if not v_rank.is_calibrated then
      -- Placement. The ladder stays invisible and untouched; only the tenth
      -- match resolves it, and it resolves from the rating those ten
      -- matches produced.
      if v_rank.calibration_matches + 1 >= c_calibration_matches then
        v_tier := public.ranked_tier_for_rating(v_new_rating);
        v_pips := 3;
        v_calibrated_now := true;
      end if;

    elsif v_actual = 1 then
      if v_series then
        -- The qualifying win. Tier 8 has nowhere to go — a Rally Legend
        -- keeps the full five pips and climbs on AAR alone.
        if v_tier < 8 then
          v_tier := v_tier + 1;
          v_pips := 1;
          v_promoted := true;
          v_protection := least(c_max_protection, v_protection + 1);
        end if;
        v_series := false;
      elsif v_pips < 5 then
        v_pips := v_pips + 1;
        v_pip_delta := 1;
        if v_pips = 5 then
          v_series := true;
        end if;
      end if;

    else
      -- A loss. Star protection is spent before anything is lost, and it
      -- protects the promotion series too — losing the qualifying match
      -- with a protection banked leaves you still standing on five pips.
      if v_protection > 0 then
        v_protection := v_protection - 1;
        v_protected := true;
      elsif v_pips > 0 then
        v_pips := v_pips - 1;
        v_pip_delta := -1;
        v_series := false;
      elsif v_tier > 1 then
        v_tier := v_tier - 1;
        v_pips := 5;
        v_series := true;
        v_demoted := true;
      end if;
      -- Tier 1 at zero pips is the floor: nothing below Dinker I.
    end if;

    v_streak := case
      when v_actual = 1 then greatest(v_rank.current_streak, 0) + 1
      else least(v_rank.current_streak, 0) - 1
    end;

    update public.player_ranks
    set rating = v_new_rating,
        tier = v_tier,
        pips = v_pips,
        in_promotion_series = v_series,
        star_protection = v_protection,
        calibration_matches = case when v_rank.is_calibrated then v_rank.calibration_matches
                                   else v_rank.calibration_matches + 1 end,
        is_calibrated = v_rank.is_calibrated or v_calibrated_now,
        wins = wins + (case when v_actual = 1 then 1 else 0 end),
        losses = losses + (case when v_actual = 0 then 1 else 0 end),
        current_streak = v_streak,
        best_streak = greatest(best_streak, v_streak),
        -- High-water mark, compared as one number so tier beats pips.
        best_tier = case
          when (v_rank.is_calibrated or v_calibrated_now)
           and (best_tier is null or (v_tier * 10 + v_pips) > (best_tier * 10 + coalesce(best_pips, 0)))
          then v_tier else best_tier end,
        best_pips = case
          when (v_rank.is_calibrated or v_calibrated_now)
           and (best_tier is null or (v_tier * 10 + v_pips) > (best_tier * 10 + coalesce(best_pips, 0)))
          then v_pips else best_pips end,
        updated_at = now()
    where season_id = v_match.season_id and user_id = v_player.user_id;

    update public.ranked_match_players
    set rating_before = v_rank.rating,
        rating_after = v_new_rating,
        rating_delta = v_delta,
        -- Tier/pip snapshots stay null for a match played during
        -- calibration: there was no visible ladder to move.
        tier_before = case when v_rank.is_calibrated then v_rank.tier end,
        pips_before = case when v_rank.is_calibrated then v_rank.pips end,
        tier_after = case when v_rank.is_calibrated or v_calibrated_now then v_tier end,
        pips_after = case when v_rank.is_calibrated or v_calibrated_now then v_pips end,
        pip_delta = v_pip_delta,
        star_protected = v_protected
    where match_id = p_match_id and user_id = v_player.user_id;

    -- One notification per player, describing the single most significant
    -- thing that happened to them. Rank movement outranks a pip, a pip
    -- outranks a protection, and a plain result gets nothing extra — the
    -- confirmation notification below already covers that case.
    if v_calibrated_now then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_calibration_complete', 'Calibration complete',
              'Ten matches played. You have been placed.', '/ranked');
    elsif v_promoted then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_rank_up', 'Rank up',
              'You promoted to tier ' || v_tier || '. Pips reset to I.', '/ranked');
    elsif v_demoted then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_rank_down', 'Rank down',
              'You dropped to tier ' || v_tier || ' with a full five pips.', '/ranked');
    elsif v_protected then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_star_protected', 'Star protected',
              'You lost, but your pip was protected. ' || v_protection || ' left.', '/ranked');
    elsif v_pip_delta <> 0 then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id,
              case when v_pip_delta > 0 then 'ranked_pip_gained' else 'ranked_pip_lost' end,
              case when v_pip_delta > 0 then 'Pip gained' else 'Pip lost' end,
              'You are now on ' || v_pips || ' of 5 pips.', '/ranked');
    end if;
  end loop;

  update public.ranked_matches
  set status = 'confirmed', rank_applied = true, confirmed_at = now(), updated_at = now()
  where id = p_match_id;

  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_result_confirmed', 'Result confirmed',
         'All players accepted ' || v_match.score_a || '–' || v_match.score_b || '. Ratings applied.',
         '/ranked/match/' || p_match_id
  from public.ranked_match_players p
  where p.match_id = p_match_id;
end;
$$;

revoke execute on function public.apply_ranked_result(uuid) from public, anon, authenticated;

create or replace function public.apply_ranked_result_if_unanimous(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding integer;
begin
  select count(*) into v_outstanding
  from public.ranked_match_players
  where match_id = p_match_id and result_response <> 'accepted';

  if v_outstanding = 0 then
    perform public.apply_ranked_result(p_match_id);
  end if;
end;
$$;

revoke execute on function public.apply_ranked_result_if_unanimous(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Confirming or disputing
-- ---------------------------------------------------------------------------

create or replace function public.respond_ranked_result(
  p_match_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
  v_name text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'awaiting_confirmation' then
    raise exception 'There is no result waiting on you.' using errcode = 'AR001';
  end if;
  if not p_accept and coalesce(trim(p_reason), '') = '' then
    raise exception 'Tell us why you are disputing this result.' using errcode = 'AR001';
  end if;

  update public.ranked_match_players
  set result_response = case when p_accept then 'accepted' else 'disputed' end,
      dispute_reason = case when p_accept then null else p_reason end
  where match_id = p_match_id and user_id = v_caller;

  if not found then
    raise exception 'You are not in this match.' using errcode = 'AR001';
  end if;

  if p_accept then
    perform public.apply_ranked_result_if_unanimous(p_match_id);
    return;
  end if;

  -- A dispute is absorbing. Nothing is applied, and no later acceptance
  -- un-disputes it — this leaves the ladder honest by default and puts the
  -- decision with a person rather than with whoever taps last.
  update public.ranked_matches
  set status = 'disputed', dispute_reason = p_reason, updated_at = now()
  where id = p_match_id;

  select coalesce(display_name, 'A player') into v_name from public.profiles where id = v_caller;

  insert into public.notifications (user_id, type, title, message, link_url)
  select u, 'ranked_result_disputed', 'Result disputed',
         v_name || ' disputed the score: ' || p_reason || '. No ratings applied until it is resolved.',
         '/ranked/match/' || p_match_id
  from (
    select user_id as u from public.ranked_match_players where match_id = p_match_id
    union
    select v_match.scorekeeper_id where v_match.scorekeeper_id is not null
  ) recipients
  where u <> v_caller;
end;
$$;

revoke execute on function public.respond_ranked_result(uuid, boolean, text) from public, anon;
grant execute on function public.respond_ranked_result(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Abandoning
-- ---------------------------------------------------------------------------

-- Any participant can cancel a match that never reached a final score.
-- Deliberately unavailable from `awaiting_confirmation` onward: once a
-- score exists, the way out is accept or dispute, not delete.
create or replace function public.cancel_ranked_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_match public.ranked_matches%rowtype;
begin
  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status not in ('lobby', 'officiating', 'live') then
    raise exception 'This match can no longer be cancelled.' using errcode = 'AR001';
  end if;
  if not exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = v_caller
  ) and not public.is_admin() then
    raise exception 'You are not in this match.' using errcode = 'AR001';
  end if;

  update public.ranked_matches
  set status = 'cancelled', updated_at = now()
  where id = p_match_id;
end;
$$;

revoke execute on function public.cancel_ranked_match(uuid) from public, anon;
grant execute on function public.cancel_ranked_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin dispute resolution
-- ---------------------------------------------------------------------------

-- The only way out of `disputed`. `p_score_a`/`p_score_b` let an admin
-- correct the score that was in dispute before applying it; passing the
-- existing score upholds the original submission. Cancelling instead is
-- the "we cannot tell what happened" answer, and costs nobody anything.
create or replace function public.resolve_ranked_dispute(
  p_match_id uuid,
  p_uphold boolean,
  p_score_a smallint default null,
  p_score_b smallint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.ranked_matches%rowtype;
  v_a smallint;
  v_b smallint;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'AR001';
  end if;

  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_match.status <> 'disputed' then
    raise exception 'This match is not disputed.' using errcode = 'AR001';
  end if;

  if not p_uphold then
    update public.ranked_matches set status = 'cancelled', updated_at = now() where id = p_match_id;

    insert into public.notifications (user_id, type, title, message, link_url)
    select p.user_id, 'ranked_dispute_resolved', 'Dispute resolved',
           'The match was voided. No ratings changed.', '/ranked/match/' || p_match_id
    from public.ranked_match_players p where p.match_id = p_match_id;
    return;
  end if;

  v_a := coalesce(p_score_a, v_match.score_a);
  v_b := coalesce(p_score_b, v_match.score_b);
  if v_a = v_b then
    raise exception 'A ranked match cannot end level.' using errcode = 'AR001';
  end if;

  update public.ranked_matches
  set score_a = v_a,
      score_b = v_b,
      winning_team = case when v_a > v_b then 'a' else 'b' end,
      status = 'awaiting_confirmation',
      dispute_reason = null,
      updated_at = now()
  where id = p_match_id;

  update public.ranked_match_players
  set result_response = 'accepted', dispute_reason = null
  where match_id = p_match_id;

  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_dispute_resolved', 'Dispute resolved',
         'An admin settled the score at ' || v_a || '–' || v_b || '. Ratings applied.',
         '/ranked/match/' || p_match_id
  from public.ranked_match_players p where p.match_id = p_match_id;

  perform public.apply_ranked_result(p_match_id);
end;
$$;

revoke execute on function public.resolve_ranked_dispute(uuid, boolean, smallint, smallint) from public, anon;
grant execute on function public.resolve_ranked_dispute(uuid, boolean, smallint, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- The scoreboard is a shared surface: the referee taps, and four phones
-- update. Adding these to the Realtime publication is what makes that a
-- subscription instead of a poll. RLS still applies to Realtime, so a
-- non-participant receives nothing.
--
-- REPLICA IDENTITY FULL first, and it is not optional. Realtime
-- re-evaluates each changed table's RLS policies per subscriber before
-- delivering a postgres_changes event, and with the default replica
-- identity (primary key columns only) an UPDATE's WAL record doesn't
-- carry enough of the row for that re-check to succeed — this codebase's
-- ranked_matches policy in particular has to inspect status/created_by/
-- scorekeeper_id, none of which are the primary key. The practical
-- symptom, confirmed live against staging, is silent and total: the
-- channel reports SUBSCRIBED, writes succeed, and zero UPDATE events
-- ever arrive — no error anywhere, because there is nothing to error on.
-- A plain Postgres feature, not a Supabase one, so it needs no existence
-- guard the way the publication below does.
alter table public.ranked_matches replica identity full;
alter table public.ranked_match_players replica identity full;
alter table public.ranked_match_points replica identity full;

-- Guarded because `supabase_realtime` is a Supabase construct, not a
-- Postgres one — the migration has to stay runnable against a plain
-- database (scripts/apply-*-migrations.ts and a local psql both do this).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ranked_matches;
    alter publication supabase_realtime add table public.ranked_match_players;
    alter publication supabase_realtime add table public.ranked_match_points;
  end if;
end;
$$;
