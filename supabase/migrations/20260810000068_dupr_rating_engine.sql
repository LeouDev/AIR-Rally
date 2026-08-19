-- AIR/Rally Ranked — DUPR-inspired dynamic rating engine.
--
-- Replaces 20260810000067's win/loss point system with a performance-vs-
-- expectation engine: how a player did compared with what the system
-- expected of them, not just whether they won. This is AIR/Rally's own
-- mathematically-sound approximation of DUPR's PUBLICLY DOCUMENTED
-- mechanics (a modified Elo algorithm; rating moves on performance vs.
-- expected score, match type, match count, and match recency) — not a
-- claim of DUPR's actual proprietary formula, which nobody outside DUPR
-- has.
--
-- Everything the product-facing 20260810000067 build preserves stays
-- exactly as it was: 10 calibration matches, singles + doubles, the
-- referee/officiating/live-scoreboard/dispute flow (none of that is
-- touched by this file), Dinker-floor/Champion-ceiling. What changes:
--
--   * Score margin now matters. `apply_ranked_result()`'s `actual` term
--     was a strict win(1)/loss(0); it becomes the point SHARE actually
--     won (11-9 is a much smaller "win" than 11-3).
--   * The rank ladder drops from 8 tiers to 7 (Rally Legend is retired —
--     see the new spec's explicit ladder) and, more fundamentally, rank
--     and star STOP being a stateful win/loss ratchet and BECOME a pure,
--     stateless function of the current rating (`ranked_rank_for_aar()`)
--     — recomputed and written every time the rating changes, never
--     independently incremented. `star_protection` is retired as a
--     consequence: there is no longer a discrete "pip" to protect, only
--     a number that has to move honestly.
--   * Singles and doubles get fully independent ratings. `player_ranks`'
--     primary key gains `mode` (`season_id, user_id, mode`) rather than
--     duplicating every column twice — the standard relational answer to
--     "one entity, two independent instances of the same attributes."
--   * New dimensions: match-type weighting (self-reported/club/league/
--     tournament/ranked), a recency multiplier, a reliability/confidence
--     score (0-100, NOT a measure of skill — see `ranked_reliability()`),
--     and a sandbagging risk score for admin review only (never an
--     automatic penalty).
--   * `ranked_party_spread()` and the matchmaking-eligibility check move
--     from comparing the discrete `tier` column to comparing the
--     continuous `rating` (AAR) number directly, per the new spec's
--     explicit instruction not to use rank names for this.
--
-- Nothing here has shipped to production. Staging holds exactly two
-- `player_ranks` rows, both still at their tier-4/pips-0 placeholder
-- default with one confirmed test match applied — this migration DROPS
-- and recreates `player_ranks` and its dependents rather than carefully
-- ALTERing a primary key in place, because there is no real data to
-- preserve yet. That is a rare freedom this migration takes deliberately;
-- if this ships after real players exist, dropping the table is wrong
-- and this file needs a backfill pass instead (recompute mode-split
-- ratings from `ranked_match_players` history, seed `reliability` from
-- match count) before being reused as-is.

-- ---------------------------------------------------------------------------
-- New columns on tables that are NOT being dropped
-- ---------------------------------------------------------------------------

alter table public.ranked_matches
  add column match_weight_type text not null default 'air_rally_ranked'
    check (match_weight_type in ('self_reported_rec', 'club', 'league', 'tournament', 'air_rally_ranked'));

comment on column public.ranked_matches.match_weight_type is
  'How much this match counts toward rating, per AIR/Rally''s DUPR-inspired weighting (ranked_match_weight()). Every match created through create_ranked_match() today is air_rally_ranked — the other four values exist for a future self-report/club/league/tournament entry point that does not exist yet.';

alter table public.ranked_match_players
  -- Denormalized from the match at creation time (create_ranked_match()
  -- already knows p_match_type) rather than left null until confirmation
  -- — unlike the rating-event columns below, this is known up front.
  add column mode text check (mode in ('singles', 'doubles')),
  -- The full "why did my rating change" breakdown, §17 of the spec.
  -- Null until apply_ranked_result() writes it once, same as the
  -- existing rating_before/after/delta columns they sit alongside.
  add column expected_score numeric,
  add column actual_score numeric,
  add column performance_gap numeric,
  add column match_weight numeric,
  add column recency_multiplier numeric,
  add column reliability_modifier numeric;

comment on column public.ranked_match_players.actual_score is
  'The point SHARE this player''s team actually won (e.g. 9/20 = 0.45 for an 11-9 game) — not the raw score, and not a binary win/loss.';

-- ---------------------------------------------------------------------------
-- Drop what's being replaced, in dependency order
-- ---------------------------------------------------------------------------

drop view if exists public.ranked_leaderboard;

drop function if exists public.apply_ranked_result(uuid);
drop function if exists public.create_ranked_match(text, uuid[], uuid[], uuid, uuid);
drop function if exists public.ranked_party_spread(uuid[]);
drop function if exists public.ensure_my_player_rank();
drop function if exists public.ensure_player_rank(uuid);
drop function if exists public.ranked_tier_for_rating(integer);

-- Cascades the table's own RLS policy and index — both recreated below.
drop table if exists public.player_ranks;

-- ---------------------------------------------------------------------------
-- player_ranks, recreated with mode in the primary key
-- ---------------------------------------------------------------------------

create table public.player_ranks (
  season_id smallint not null references public.ranked_seasons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Reuses RankedMatchType ('singles' | 'doubles') — a player's rating
  -- under this mode, not what kind of match is being played.
  mode text not null check (mode in ('singles', 'doubles')),

  -- AAR. Starts at 1000 on the new scale (was 1500) — hidden from the
  -- player until calibration finishes, moving the whole time regardless.
  rating integer not null default 1000,

  -- The visible ladder — STATELESS now. tier/pips are written by
  -- ranked_rank_for_aar(rating) every time rating changes; nothing ever
  -- increments or decrements them independently. Meaningless (and
  -- unread by the UI) until is_calibrated flips, same as before.
  tier smallint not null default 1 check (tier between 1 and 7),
  pips smallint not null default 1 check (pips between 1 and 5),

  -- 0-100 confidence in `rating`, NOT a measure of skill — see
  -- ranked_reliability(). Grows with match volume, decays with
  -- inactivity, dampens (but never freezes) future volatility.
  reliability smallint not null default 0 check (reliability between 0 and 100),

  -- 0-100, admin-review signal only — never an automatic penalty. See
  -- the sandbag-risk update inside apply_ranked_result().
  sandbag_risk_score smallint not null default 0 check (sandbag_risk_score between 0 and 100),

  -- Read at the START of a player's next match to compute how long
  -- they've been away (feeds both recency-of-reliability and, later, an
  -- admin dispute-resolution delay) — written at the END of every one of
  -- their confirmed matches.
  last_match_at timestamptz,

  -- Placement: the first ten ranked matches move AAR at the wide
  -- calibration K and show no rank at all. Results still count — they
  -- are what places the player.
  calibration_matches integer not null default 0 check (calibration_matches >= 0),
  is_calibrated boolean not null default false,

  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  current_streak integer not null default 0,
  best_streak integer not null default 0 check (best_streak >= 0),

  -- High-water marks, for the "new best rank" moment. Null until
  -- calibrated. Unaffected by the star-protection retirement below —
  -- this was always a plain high-water mark, never the protection itself.
  best_tier smallint check (best_tier between 1 and 7),
  best_pips smallint check (best_pips between 1 and 5),

  -- Retired as a rating mechanic (see this file's header) — a discrete
  -- "protect one pip from a loss" no longer makes sense once pips are a
  -- stateless function of a continuous number that has to move honestly.
  -- Columns kept, not dropped, purely so old confirmed-match history
  -- that already rendered `ranked_match_players.star_protected` keeps
  -- reading correctly; no new code writes true to either of these.
  in_promotion_series boolean not null default false,
  star_protection smallint not null default 0 check (star_protection between 0 and 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season_id, user_id, mode)
);

-- The leaderboard's only ordering (now per mode), and the "where am I"
-- lookup behind it.
create index player_ranks_season_mode_rating_idx
  on public.player_ranks (season_id, mode, rating desc, user_id)
  where is_calibrated;

alter table public.player_ranks enable row level security;

-- Standings are public — unchanged reasoning from 20260810000067: they're
-- printed on profiles, the leaderboard and every match lobby, and a
-- rating existing at all is not sensitive.
create policy "Ranks are public"
on public.player_ranks for select
using (true);

-- ---------------------------------------------------------------------------
-- The rating engine's tunable pieces — each one small, named, and
-- independently callable so it can be tuned or tested in isolation,
-- rather than buried inline in apply_ranked_result(). This IS the
-- "central configuration" the spec asks for (§1, §6): change a value by
-- editing the one function that owns it, not by hunting through the
-- 150-line function that applies a whole match.
-- ---------------------------------------------------------------------------

-- Stateless rank+star from a raw AAR value — see this file's header.
-- Dinker is 1000 AAR wide (0-999); every other rank is 200 wide; star
-- width is band-width/5 in both cases — not a special case, just the
-- ratio the spec's own worked examples ("Star 1 = first 40 points" on a
-- 200-wide rank) already imply, applied uniformly. Champion has no
-- ceiling on rating, but its band for STAR purposes stops at 2199 (5
-- stars x 40) like every other rank — a rating past that still displays
-- Champion / 5 stars while the number itself keeps climbing for
-- leaderboard-sort purposes.
create or replace function public.ranked_rank_for_aar(p_rating integer)
returns table(tier smallint, pips smallint)
language sql
immutable
as $$
  with band as (
    select
      (case
        when p_rating < 1000 then 1
        when p_rating < 1200 then 2
        when p_rating < 1400 then 3
        when p_rating < 1600 then 4
        when p_rating < 1800 then 5
        when p_rating < 2000 then 6
        else 7
      end)::smallint as t,
      case
        when p_rating < 1000 then 0
        when p_rating < 1200 then 1000
        when p_rating < 1400 then 1200
        when p_rating < 1600 then 1400
        when p_rating < 1800 then 1600
        when p_rating < 2000 then 1800
        else 2000
      end as band_floor,
      -- Dinker's band is 5x wider than every other rank's, so its star
      -- width is 5x wider too (1000/5 vs 200/5) — same ratio, not a
      -- special case.
      (case when p_rating < 1000 then 200 else 40 end) as star_width
  )
  select
    t,
    least(5, greatest(1, ((p_rating - band_floor) / star_width) + 1))::smallint
  from band;
$$;

-- Standard logistic Elo, divisor 400 — both sides are plain rating
-- numbers; a team's "own rating" is the average of its players, computed
-- by the caller (apply_ranked_result()), same as before this migration.
create or replace function public.ranked_expected_score(p_own_rating numeric, p_opponent_rating numeric)
returns numeric
language sql
immutable
as $$
  select 1.0 / (1.0 + power(10.0, (p_opponent_rating - p_own_rating) / 400.0));
$$;

-- AIR/Rally tuning parameters inspired by DUPR's public statement that
-- organized competitive matches carry more weight than self-reported
-- recreational ones — NOT a claim of DUPR's actual weights.
create or replace function public.ranked_match_weight(p_type text)
returns numeric
language sql
immutable
as $$
  select case p_type
    when 'self_reported_rec' then 0.50
    when 'club' then 1.00
    when 'league' then 1.50
    when 'tournament' then 2.00
    when 'air_rally_ranked' then 1.50
    else 1.00
  end;
$$;

-- Match-age-based weight. In practice this is almost always 1.00 — a
-- match confirms within minutes of being played — but it becomes real
-- once a delayed admin dispute resolution applies a result well after
-- the fact.
create or replace function public.ranked_recency_multiplier(p_days_old integer)
returns numeric
language sql
immutable
as $$
  select case
    when p_days_old <= 29 then 1.00
    when p_days_old <= 60 then 0.90
    when p_days_old <= 90 then 0.80
    when p_days_old <= 180 then 0.65
    else 0.50
  end;
$$;

-- AIR/Rally tuning parameters, not claimed DUPR values. Calibration
-- moves fast and wide; established play is slower and narrower.
create or replace function public.ranked_k_factor(p_is_calibrated boolean)
returns integer
language sql
immutable
as $$
  select case when p_is_calibrated then 40 else 80 end;
$$;

create or replace function public.ranked_max_delta(p_is_calibrated boolean)
returns integer
language sql
immutable
as $$
  select case when p_is_calibrated then 60 else 120 end;
$$;

-- 0-100 confidence in a player's current rating — NOT a measure of
-- skill (see the column comment). Grows with match volume on a
-- saturating curve (~63% by 15 matches, ~86% by 30), reduced by a decay
-- factor once a player has been away — reusing the same 30/90/180-day
-- breakpoints ranked_recency_multiplier() uses, since both are versions
-- of "how much has time eroded confidence in this number." An AIR/Rally
-- approximation, not a claimed DUPR formula.
create or replace function public.ranked_reliability(p_match_count integer, p_days_since_last integer)
returns smallint
language sql
immutable
as $$
  select greatest(0, least(100, round(
    (100 * (1 - exp(-1.0 * p_match_count / 15.0)))
    * case
        when p_days_since_last is null then 1.0
        when p_days_since_last <= 30 then 1.0
        when p_days_since_last <= 90 then 0.85
        when p_days_since_last <= 180 then 0.65
        else 0.45
      end
  )))::smallint;
$$;

comment on function public.ranked_reliability(integer, integer) is
  'A confidence score, not a skill score. AAR 1700 at reliability 25% means "we think ~1700 but need more evidence"; AAR 1700 at reliability 92% means "strong evidence that is accurate."';

-- Damps volatility for a well-established rating without ever freezing
-- it — floors at 0.5 (half the normal swing) even at reliability 100,
-- because the system has to stay able to reflect real improvement or
-- decline. An AIR/Rally tuning choice, not a claimed DUPR formula.
create or replace function public.ranked_reliability_modifier(p_reliability smallint)
returns numeric
language sql
immutable
as $$
  select 1.0 - (p_reliability / 100.0) * 0.5;
$$;

-- Internal: every one of the eight functions above is pure math with no
-- table access of its own, called only from inside apply_ranked_result()
-- (and, for ranked_rank_for_aar, nowhere else yet) — none of them is a
-- client-reachable RPC today, so none gets a client grant, matching the
-- same "internal, no grants" posture as ensure_player_rank() below and
-- apply_ranked_result() itself.
revoke execute on function public.ranked_rank_for_aar(integer) from public, anon, authenticated;
revoke execute on function public.ranked_expected_score(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.ranked_match_weight(text) from public, anon, authenticated;
revoke execute on function public.ranked_recency_multiplier(integer) from public, anon, authenticated;
revoke execute on function public.ranked_k_factor(boolean) from public, anon, authenticated;
revoke execute on function public.ranked_max_delta(boolean) from public, anon, authenticated;
revoke execute on function public.ranked_reliability(integer, integer) from public, anon, authenticated;
revoke execute on function public.ranked_reliability_modifier(smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Standing bootstrap — now per mode
-- ---------------------------------------------------------------------------

create or replace function public.ensure_player_rank(p_user_id uuid, p_mode text)
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
  if p_mode not in ('singles', 'doubles') then
    raise exception 'Unknown mode.' using errcode = 'AR001';
  end if;

  insert into public.player_ranks (season_id, user_id, mode)
  values (v_season, p_user_id, p_mode)
  on conflict (season_id, user_id, mode) do nothing;

  select * into v_row from public.player_ranks
  where season_id = v_season and user_id = p_user_id and mode = p_mode;

  return v_row;
end;
$$;

-- Internal: create_ranked_match() has to bootstrap every player in the
-- party, not just the caller — exactly why no client role may call it
-- directly, same reasoning as 20260810000067.
revoke execute on function public.ensure_player_rank(uuid, text) from public, anon, authenticated;

create or replace function public.ensure_my_player_rank(p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;
  perform public.ensure_player_rank(auth.uid(), p_mode);
end;
$$;

revoke execute on function public.ensure_my_player_rank(text) from public, anon;
grant execute on function public.ensure_my_player_rank(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Party eligibility — AAR-based, not tier-based (§14/§15 of the spec:
-- "Do not use visible rank names for this calculation. Use AAR.")
-- ---------------------------------------------------------------------------

create or replace function public.ranked_party_spread(p_user_ids uuid[], p_mode text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(rating) - min(rating), 0)
  from public.player_ranks
  where season_id = public.current_ranked_season()
    and user_id = any(p_user_ids)
    and mode = p_mode
    and is_calibrated;
$$;

grant execute on function public.ranked_party_spread(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a match — same shape as 20260810000067, spread check now AAR-based
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
  -- Ranked doubles parties may span at most this many AAR points — wider
  -- than that and the match stops being a measurement (see
  -- RANKED_MAX_PARTY_AAR_SPREAD in lib/rating.ts, kept in lockstep by
  -- scripts/verify-ranked-rating-engine.ts). A constant here, not a
  -- separate config function, because unlike the rating-formula pieces
  -- above nothing else needs to call it independently.
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

  -- Every player needs a standing, in THIS match's mode specifically,
  -- before the spread can be read.
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

-- ---------------------------------------------------------------------------
-- The rating engine itself
-- ---------------------------------------------------------------------------

-- Internal: no grants, reached only through submit_ranked_result() /
-- respond_ranked_result() (both defined in 20260810000067, unchanged by
-- this migration — they call this same function name, so the new body
-- below is picked up automatically, no caller-side change needed) via
-- apply_ranked_result_if_unanimous(). rank_applied plus the row lock
-- below is what makes a double-apply impossible even under concurrent
-- confirmations — unchanged reasoning from 20260810000067.
create or replace function public.apply_ranked_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_calibration_matches constant integer := 10;

  v_match public.ranked_matches%rowtype;
  v_avg_a numeric;
  v_avg_b numeric;
  v_player record;
  v_rank public.player_ranks%rowtype;

  v_opponent_avg numeric;
  v_own_score integer;
  v_opponent_score integer;
  v_actual numeric;
  v_expected numeric;
  v_gap numeric;
  v_weight numeric;
  v_recency numeric;
  v_reliability_mod numeric;
  v_k integer;
  v_raw_delta numeric;
  v_delta integer;
  v_new_rating integer;
  v_days_old integer;
  v_days_since_last integer;

  v_tier smallint;
  v_pips smallint;
  v_old_tier smallint;
  v_old_pips smallint;
  v_new_reliability smallint;
  v_calibrated_now boolean;
  v_streak integer;
  v_sandbag_score smallint;
  v_won boolean;
begin
  select * into v_match from public.ranked_matches where id = p_match_id for update;
  if v_match.id is null
     or v_match.rank_applied
     or v_match.winning_team is null
     or v_match.status <> 'awaiting_confirmation' then
    return;
  end if;

  -- Team strength is the mean of its players' CURRENT-MODE ratings —
  -- unchanged reasoning from 20260810000067: a doubles pairing is one
  -- entity for this purpose, since a single score line can't separate a
  -- partner's individual contribution.
  select avg(pr.rating) into v_avg_a
  from public.ranked_match_players mp
  join public.player_ranks pr
    on pr.user_id = mp.user_id and pr.season_id = v_match.season_id and pr.mode = mp.mode
  where mp.match_id = p_match_id and mp.team = 'a';

  select avg(pr.rating) into v_avg_b
  from public.ranked_match_players mp
  join public.player_ranks pr
    on pr.user_id = mp.user_id and pr.season_id = v_match.season_id and pr.mode = mp.mode
  where mp.match_id = p_match_id and mp.team = 'b';

  -- The match's age at the moment it's actually applied — almost always
  -- ~0 (matches confirm within minutes of being played); only a delayed
  -- admin dispute resolution makes this real.
  v_days_old := greatest(0, extract(day from now() - coalesce(v_match.completed_at, v_match.created_at))::integer);
  v_recency := public.ranked_recency_multiplier(v_days_old);
  v_weight := public.ranked_match_weight(v_match.match_weight_type);

  -- Ordered by user_id, not left to the heap — two matches confirming at
  -- once can share a player, and every transaction taking these row
  -- locks in the same order is what makes that a wait rather than a
  -- deadlock (unchanged reasoning from 20260810000067).
  for v_player in
    select user_id, team from public.ranked_match_players
    where match_id = p_match_id
    order by user_id
  loop
    perform public.ensure_player_rank(v_player.user_id, v_match.match_type);

    select * into v_rank from public.player_ranks
    where season_id = v_match.season_id and user_id = v_player.user_id and mode = v_match.match_type
    for update;

    v_opponent_avg := case when v_player.team = 'a' then v_avg_b else v_avg_a end;
    v_own_score := case when v_player.team = 'a' then v_match.score_a else v_match.score_b end;
    v_opponent_score := case when v_player.team = 'a' then v_match.score_b else v_match.score_a end;
    v_won := v_match.winning_team = v_player.team;

    -- The DUPR-style "actual" term: the point SHARE this player's team
    -- actually won, not a binary win/loss — an 11-9 win is a much
    -- smaller actual score than an 11-3 win.
    v_actual := v_own_score::numeric / nullif(v_own_score + v_opponent_score, 0);
    v_expected := public.ranked_expected_score(v_rank.rating, v_opponent_avg);
    v_gap := v_actual - v_expected;

    v_days_since_last := case
      when v_rank.last_match_at is null then null
      else greatest(0, extract(day from now() - v_rank.last_match_at)::integer)
    end;
    v_new_reliability := public.ranked_reliability(v_rank.calibration_matches + v_rank.wins + v_rank.losses, v_days_since_last);
    v_reliability_mod := public.ranked_reliability_modifier(v_new_reliability);

    v_k := public.ranked_k_factor(v_rank.is_calibrated);
    v_raw_delta := v_k * v_gap * v_weight * v_reliability_mod * v_recency;
    v_delta := round(v_raw_delta)::integer;
    -- Cap AFTER rounding, on the signed value — a huge weight/gap
    -- combination (e.g. a tournament blowout) can't produce a swing
    -- bigger than the calibration/established ceiling either direction.
    v_delta := greatest(-public.ranked_max_delta(v_rank.is_calibrated), least(public.ranked_max_delta(v_rank.is_calibrated), v_delta));
    v_new_rating := v_rank.rating + v_delta;

    v_old_tier := v_rank.tier;
    v_old_pips := v_rank.pips;
    v_calibrated_now := false;

    if not v_rank.is_calibrated and v_rank.calibration_matches + 1 >= c_calibration_matches then
      v_calibrated_now := true;
    end if;

    -- Rank/star: recomputed from the new rating every time, never
    -- independently mutated — this is the core behavioral change this
    -- migration makes. Stays at the placeholder default (tier 1 / pip 1)
    -- until calibration ends, exactly like 20260810000067's tier/pips
    -- "mean nothing until is_calibrated flips."
    if v_rank.is_calibrated or v_calibrated_now then
      select tier, pips into v_tier, v_pips from public.ranked_rank_for_aar(v_new_rating);
    else
      v_tier := v_rank.tier;
      v_pips := v_rank.pips;
    end if;

    -- Streak tracks the literal match result (same as `wins`/`losses`
    -- below), not the performance gap — a player can overperform in a
    -- loss and gain rating for it, but that is not what "3 in a row"
    -- means to someone reading their own stats.
    v_streak := case
      when v_won then greatest(v_rank.current_streak, 0) + 1
      else least(v_rank.current_streak, 0) - 1
    end;

    -- Admin-review-only signal (§16) — never an automatic penalty. A
    -- simple, clearly-approximate first pass: how many of this player's
    -- last 10 PREVIOUS confirmed matches (the one in flight right now
    -- isn't confirmed yet at this point, so it isn't in the window —
    -- deliberately: judging a pattern needs history, not one match, and
    -- this one folds into the NEXT match's computation once it confirms)
    -- were a lopsided favorite win — a high `expected_score` (the
    -- opponent was far weaker) combined with actually winning is exactly
    -- the "farming" shape — plus a flag for an unusually large swing on
    -- an established (already-calibrated) rating, which is otherwise
    -- supposed to be stable. Weighted, capped at 100, intentionally
    -- conservative — tune once there is real data to tune it against.
    --
    -- The 0.75 threshold below is deliberately NOT 0.85 or higher: this
    -- codebase's own party-spread cap (create_ranked_match()'s
    -- c_max_party_spread, 250 AAR) makes ~0.81 the highest expected_score
    -- two players in a LEGAL ranked party can ever produce today — a
    -- higher threshold here would be permanently unreachable and this
    -- signal would never fire under any match this app can currently
    -- create. 0.75 corresponds to roughly a 200-AAR gap, comfortably
    -- inside that cap. Revisit both numbers together if either changes.
    --
    -- Plain assignment, not SELECT INTO: this is a scalar expression
    -- (with an embedded scalar subquery), and plpgsql's SELECT INTO
    -- syntax expects INTO after the select-list, not before it — `:=`
    -- sidesteps the question entirely.
    v_sandbag_score := least(100, round(
      -- Up to 70 points for a pattern of beating much weaker opponents.
      70.0 * (
        select count(*)::numeric / 10
        from (
          select mp2.expected_score, (m2.winning_team = mp2.team) as won
          from public.ranked_match_players mp2
          join public.ranked_matches m2 on m2.id = mp2.match_id
          where mp2.user_id = v_player.user_id
            and mp2.mode = v_match.match_type
            and m2.status = 'confirmed'
            and mp2.performance_gap is not null
          order by m2.confirmed_at desc
          limit 10
        ) recent
        where recent.won and recent.expected_score >= 0.75
      )
      -- Up to 30 points for an established rating swinging unusually
      -- hard in one match (established players are supposed to be
      -- stable; a near-max-cap swing is the flag, not the swing itself).
      + case when v_rank.is_calibrated and abs(v_delta) >= (public.ranked_max_delta(true) * 0.75) then 30 else 0 end
    ))::smallint;

    update public.player_ranks
    set rating = v_new_rating,
        tier = v_tier,
        pips = v_pips,
        reliability = v_new_reliability,
        sandbag_risk_score = v_sandbag_score,
        last_match_at = now(),
        calibration_matches = case when v_rank.is_calibrated then v_rank.calibration_matches
                                   else v_rank.calibration_matches + 1 end,
        is_calibrated = v_rank.is_calibrated or v_calibrated_now,
        wins = wins + (case when v_won then 1 else 0 end),
        losses = losses + (case when not v_won then 1 else 0 end),
        current_streak = v_streak,
        best_streak = greatest(best_streak, v_streak),
        best_tier = case
          when (v_rank.is_calibrated or v_calibrated_now)
           and (best_tier is null or (v_tier * 10 + v_pips) > (best_tier * 10 + coalesce(best_pips, 0)))
          then v_tier else best_tier end,
        best_pips = case
          when (v_rank.is_calibrated or v_calibrated_now)
           and (best_tier is null or (v_tier * 10 + v_pips) > (best_tier * 10 + coalesce(best_pips, 0)))
          then v_pips else best_pips end,
        updated_at = now()
    where season_id = v_match.season_id and user_id = v_player.user_id and mode = v_match.match_type;

    update public.ranked_match_players
    set rating_before = v_rank.rating,
        rating_after = v_new_rating,
        rating_delta = v_delta,
        tier_before = case when v_rank.is_calibrated then v_old_tier end,
        pips_before = case when v_rank.is_calibrated then v_old_pips end,
        tier_after = case when v_rank.is_calibrated or v_calibrated_now then v_tier end,
        pips_after = case when v_rank.is_calibrated or v_calibrated_now then v_pips end,
        pip_delta = case when v_rank.is_calibrated and not v_calibrated_now then v_pips - v_old_pips else 0 end,
        expected_score = v_expected,
        actual_score = v_actual,
        performance_gap = v_gap,
        match_weight = v_weight,
        recency_multiplier = v_recency,
        reliability_modifier = v_reliability_mod
    where match_id = p_match_id and user_id = v_player.user_id;

    -- One notification per player, most-significant-thing-first — same
    -- priority order as 20260810000067 (rank change beats a pip beats a
    -- plain result), minus star-protection (retired) and rewritten to
    -- fire off the newly-derived tier instead of a ratchet event.
    if v_calibrated_now then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_calibration_complete', 'Calibration complete',
              'Ten matches played. You have been placed.', '/ranked');
    elsif v_rank.is_calibrated and v_tier > v_old_tier then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_rank_up', 'Rank up',
              'You promoted to tier ' || v_tier || '.', '/ranked');
    elsif v_rank.is_calibrated and v_tier < v_old_tier then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id, 'ranked_rank_down', 'Rank down',
              'You dropped to tier ' || v_tier || '.', '/ranked');
    elsif v_rank.is_calibrated and v_pips <> v_old_pips then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (v_player.user_id,
              case when v_pips > v_old_pips then 'ranked_pip_gained' else 'ranked_pip_lost' end,
              case when v_pips > v_old_pips then 'Pip gained' else 'Pip lost' end,
              'You are now on star ' || v_pips || ' of 5.', '/ranked');
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

-- ---------------------------------------------------------------------------
-- Leaderboard — now per mode
-- ---------------------------------------------------------------------------

create view public.ranked_leaderboard
with (security_invoker = true)
as
select
  r.season_id,
  r.mode,
  r.user_id,
  p.display_name,
  p.avatar_url,
  r.rating,
  r.tier,
  r.pips,
  r.wins,
  r.losses,
  r.reliability,
  rank() over (partition by r.season_id, r.mode order by r.rating desc, r.user_id) as position
from public.player_ranks r
join public.public_profiles p on p.id = r.user_id
where r.is_calibrated;

grant select on public.ranked_leaderboard to anon, authenticated;
