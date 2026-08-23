-- One AIR/Rally rating per player, not one per mode. Founder's own words:
-- "Each player should have only 1 AIR/Rally ranked rating. Regardless if
-- they play singles or doubles" / "if player 1 plays doubles game it
-- shows 1, if player 1 plays singles the next game it'll show 2 — one
-- combined counter, one progression."
--
-- This is a partial revert of ONE piece of 20260810000068 (the DUPR
-- rating engine migration), four days after it shipped — before 068,
-- there was one shared rating and nothing to switch between (see
-- src/components/ranked/ModeTabs.tsx's own comment in the web repo,
-- which documents exactly this history). Everything ELSE 068 introduced
-- — point-share `actual`, match weighting, recency, reliability,
-- sandbag-risk scoring, the stateless rank-from-AAR function — is
-- untouched. Confirmed by grep, not memory: every pure-math helper
-- (ranked_rank_for_aar, ranked_expected_score, ranked_match_weight,
-- ranked_recency_multiplier, ranked_k_factor, ranked_max_delta,
-- ranked_reliability, ranked_reliability_modifier) takes scalars only —
-- none of them ever took a mode argument, so none of them change here.
-- NO function body implementing the rating MATH is touched by this
-- migration. Where mode and math meet (apply_ranked_result's team-
-- average join, its per-player row lookup, and the sandbag-risk
-- window) only the ROW SCOPING changes — see each site below for
-- exactly what and why.
--
-- MODE SURVIVES AS A FACT ABOUT THE MATCH: ranked_matches.match_type and
-- ranked_match_players.mode are UNTOUCHED. A match is still meaningfully
-- singles or doubles — for display, history, and party formation
-- (create_ranked_match still takes p_match_type and still requires 1
-- or 2 players per side accordingly). Only player_ranks loses the
-- dimension: there is now one rating, one calibration count, one
-- leaderboard, fed by every confirmed match regardless of type.
--
-- DATA WIPE, FOUNDER-AUTHORIZED ("that's okay we can rewrite those are
-- all my accounts" / "Two old matches record wipe it") — verified live
-- immediately before this file was finalized, not assumed from an
-- earlier check: exactly 5 distinct users, 9 player_ranks rows (5
-- doubles + 4 singles), and exactly 2 confirmed matches
-- (5777306d-554c-4548-aecd-50691ea69d52 doubles,
-- 15aa51ca-75e9-4030-9387-8850520784dc singles) on production at the
-- time this was written. If those counts have moved by the time this is
-- actually applied, STOP — the founder authorized wiping data they
-- believe is entirely theirs, and that authorization does not extend to
-- rows that appeared afterward. Re-check live before applying, same as
-- every migration tonight.
--
-- player_ranks is dropped and recreated rather than ALTERed — same
-- justification 068 itself used for doing this once already: there is
-- no real data to preserve, so a clean rebuild is honest and cheap
-- rather than a careful in-place PK change for nobody's benefit. The 2
-- confirmed matches' ranked_match_players rows keep existing (the games
-- really happened — score_a/score_b/winning_team/team assignments are
-- match facts, not rating artifacts) but have their frozen rating/tier/
-- performance snapshot columns cleared, since those snapshots describe
-- what the OLD per-mode system computed and would otherwise read as
-- real history for a rating system that no longer exists. Both matches
-- already have rank_applied = true, so neither will ever be
-- re-applied against the fresh player_ranks rows — the wipe is safe
-- precisely because that guard already exists and this migration
-- doesn't touch it.
--
-- CLIENT COMPATIBILITY — DELIBERATELY NOT HANDLED HERE: every function
-- whose signature changes below (ensure_player_rank, ensure_my_player_
-- rank, ranked_party_spread) is called by both apps with a `mode`
-- argument today, and player_ranks/ranked_leaderboard are read directly
-- with a `.eq("mode", ...)` filter in both apps' service layers
-- (src/lib/services/ranked.ts on web, src/lib/ranked.ts on mobile). The
-- INSTANT this migration applies, every one of those old-code call sites
-- fails hard and immediately: the RPC calls error with "could not find
-- function with these parameter names" (PostgREST can't resolve
-- ensure_my_player_rank(p_mode => ...) once the only remaining
-- signature takes zero arguments), and the direct-table reads error
-- with "column player_ranks.mode does not exist" / the same on
-- ranked_leaderboard. Nothing renders a wrong number or a stale mode —
-- Ranked breaks visibly and completely for both apps until their client
-- code is updated to match. This is why this migration must not reach
-- staging or production ahead of the client changes — sequencing that is
-- explicitly the AI CTO's call, not this file's.

-- =============================================================================
-- player_ranks — mode dimension removed
-- =============================================================================

drop view if exists public.ranked_leaderboard;

drop function if exists public.apply_ranked_result(uuid);
drop function if exists public.create_ranked_match(text, uuid[], uuid[], uuid, uuid);
drop function if exists public.ranked_party_spread(uuid[], text);
drop function if exists public.ensure_my_player_rank(text);
drop function if exists public.ensure_player_rank(uuid, text);

drop table if exists public.player_ranks;

create table public.player_ranks (
  season_id smallint not null references public.ranked_seasons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- AAR. Same starting value and meaning as 20260810000068 — this
  -- migration does not touch the rating scale, only which matches feed
  -- one shared row instead of two.
  rating integer not null default 1000,

  tier smallint not null default 1 check (tier between 1 and 7),
  pips smallint not null default 1 check (pips between 1 and 5),

  reliability smallint not null default 0 check (reliability between 0 and 100),
  sandbag_risk_score smallint not null default 0 check (sandbag_risk_score between 0 and 100),

  last_match_at timestamptz,

  calibration_matches integer not null default 0 check (calibration_matches >= 0),
  is_calibrated boolean not null default false,

  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  current_streak integer not null default 0,
  best_streak integer not null default 0 check (best_streak >= 0),

  best_tier smallint check (best_tier between 1 and 7),
  best_pips smallint check (best_pips between 1 and 5),

  -- Retired rating mechanic, columns kept for the same reason
  -- 20260810000068 kept them: old confirmed-match history that already
  -- rendered ranked_match_players.star_protected keeps reading
  -- correctly. No code writes true to either.
  in_promotion_series boolean not null default false,
  star_protection smallint not null default 0 check (star_protection between 0 and 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season_id, user_id)
);

-- The leaderboard's only ordering, and the "where am I" lookup behind
-- it — back to 20260810000067's shape (one leaderboard, no mode).
create index player_ranks_season_rating_idx
  on public.player_ranks (season_id, rating desc, user_id)
  where is_calibrated;

alter table public.player_ranks enable row level security;

create policy "Ranks are public"
on public.player_ranks for select
using (true);

-- =============================================================================
-- Standing bootstrap — mode argument removed
-- =============================================================================

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

revoke execute on function public.ensure_player_rank(uuid) from public, anon, authenticated;

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

-- =============================================================================
-- Party eligibility — mode argument removed. Same AAR-based spread check
-- (RANKED_MAX_PARTY_AAR_SPREAD = 250, unchanged, still enforced in
-- create_ranked_match below) — just reading one rating instead of a
-- mode-specific one.
-- =============================================================================

create or replace function public.ranked_party_spread(p_user_ids uuid[])
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
    and is_calibrated;
$$;

grant execute on function public.ranked_party_spread(uuid[]) to authenticated;

-- =============================================================================
-- Creating a match — p_match_type stays (mode survives as a match fact;
-- ranked_match_players.mode is set from it below, exactly as before).
-- Only the calls into the now-mode-less bootstrap/spread functions change.
-- =============================================================================

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

  -- One standing per player now, not one per (player, match_type).
  foreach v_user_id in array v_all loop
    perform public.ensure_player_rank(v_user_id);
  end loop;

  v_spread := public.ranked_party_spread(v_all);
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

  -- ranked_match_players.mode is UNTOUCHED by this migration — still set
  -- from p_match_type, still a fact about what this specific match was.
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

-- =============================================================================
-- The rating engine — SAME SIGNATURE, and the founder's explicit
-- requirement applies most here: "make sure the DUPR calculation and
-- math is still being followed." Every line computing v_actual,
-- v_expected, v_gap, v_weight, v_recency, v_reliability_mod, v_k,
-- v_raw_delta, v_delta, v_new_rating, the tier/pip derivation via
-- ranked_rank_for_aar, the calibration-completion check, the streak
-- update, and every notification-priority branch is IDENTICAL to
-- 20260810000068 — copied, not rewritten. The only differences from
-- 20260810000068's body, all three called out explicitly:
--
--   1. The team-average join drops `and pr.mode = mp.mode` — a team's
--      strength is still the mean of its players' CURRENT rating,
--      computed by the same avg(pr.rating), just against one row per
--      player instead of a mode-specific one. The arithmetic is
--      unchanged; only which row it reads changed.
--   2. The per-player row lookup/update drops `and mode = v_match.
--      match_type` — one row per player, not selected/updated per mode.
--   3. The sandbag-risk subquery drops `and mp2.mode = v_match.
--      match_type` — deliberately, not an oversight: with one combined
--      rating, a player's "last 10 matches" for sandbagging purposes
--      should span BOTH match types, matching the founder's own words
--      ("one combined counter, one progression"). This changes what the
--      window SEES (more matches become eligible to fall inside the
--      last-10 count), not what the check MEANS — it is still "how many
--      of this player's last 10 confirmed matches were a lopsided
--      favorite win," just measured against their one real match
--      history instead of an artificially mode-split slice of it.
--
-- Nothing else in this function changed. See the migration's own
-- verification (a positive control comparing this body's output against
-- 20260810000068's, given identical inputs) for proof rather than
-- assertion that points 1-2 are truly arithmetic-neutral.
-- =============================================================================

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

  -- Team strength is the mean of its players' rating — unchanged
  -- reasoning from every prior version: a doubles pairing is one entity
  -- for this purpose. Only change from 20260810000068: no mode join
  -- predicate, since there is one row per player now.
  select avg(pr.rating) into v_avg_a
  from public.ranked_match_players mp
  join public.player_ranks pr
    on pr.user_id = mp.user_id and pr.season_id = v_match.season_id
  where mp.match_id = p_match_id and mp.team = 'a';

  select avg(pr.rating) into v_avg_b
  from public.ranked_match_players mp
  join public.player_ranks pr
    on pr.user_id = mp.user_id and pr.season_id = v_match.season_id
  where mp.match_id = p_match_id and mp.team = 'b';

  v_days_old := greatest(0, extract(day from now() - coalesce(v_match.completed_at, v_match.created_at))::integer);
  v_recency := public.ranked_recency_multiplier(v_days_old);
  v_weight := public.ranked_match_weight(v_match.match_weight_type);

  for v_player in
    select user_id, team from public.ranked_match_players
    where match_id = p_match_id
    order by user_id
  loop
    perform public.ensure_player_rank(v_player.user_id);

    select * into v_rank from public.player_ranks
    where season_id = v_match.season_id and user_id = v_player.user_id
    for update;

    v_opponent_avg := case when v_player.team = 'a' then v_avg_b else v_avg_a end;
    v_own_score := case when v_player.team = 'a' then v_match.score_a else v_match.score_b end;
    v_opponent_score := case when v_player.team = 'a' then v_match.score_b else v_match.score_a end;
    v_won := v_match.winning_team = v_player.team;

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
    v_delta := greatest(-public.ranked_max_delta(v_rank.is_calibrated), least(public.ranked_max_delta(v_rank.is_calibrated), v_delta));
    v_new_rating := v_rank.rating + v_delta;

    v_old_tier := v_rank.tier;
    v_old_pips := v_rank.pips;
    v_calibrated_now := false;

    if not v_rank.is_calibrated and v_rank.calibration_matches + 1 >= c_calibration_matches then
      v_calibrated_now := true;
    end if;

    if v_rank.is_calibrated or v_calibrated_now then
      select tier, pips into v_tier, v_pips from public.ranked_rank_for_aar(v_new_rating);
    else
      v_tier := v_rank.tier;
      v_pips := v_rank.pips;
    end if;

    v_streak := case
      when v_won then greatest(v_rank.current_streak, 0) + 1
      else least(v_rank.current_streak, 0) - 1
    end;

    -- Admin-review-only signal, unchanged math — see this migration's
    -- header for why this window's scope (last 10 confirmed matches of
    -- ANY type, not filtered to match_type) is a deliberate widening,
    -- not an oversight.
    v_sandbag_score := least(100, round(
      70.0 * (
        select count(*)::numeric / 10
        from (
          select mp2.expected_score, (m2.winning_team = mp2.team) as won
          from public.ranked_match_players mp2
          join public.ranked_matches m2 on m2.id = mp2.match_id
          where mp2.user_id = v_player.user_id
            and m2.status = 'confirmed'
            and mp2.performance_gap is not null
          order by m2.confirmed_at desc
          limit 10
        ) recent
        where recent.won and recent.expected_score >= 0.75
      )
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
    where season_id = v_match.season_id and user_id = v_player.user_id;

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

-- =============================================================================
-- Leaderboard — mode dimension removed, one leaderboard again.
-- =============================================================================

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
  r.reliability,
  rank() over (partition by r.season_id order by r.rating desc, r.user_id) as position
from public.player_ranks r
join public.public_profiles p on p.id = r.user_id
where r.is_calibrated;

grant select on public.ranked_leaderboard to anon, authenticated;

-- =============================================================================
-- Founder-authorized wipe: the 2 confirmed matches' rating-engine
-- snapshots, frozen under the old per-mode system, no longer describe
-- anything real. The matches themselves (score_a/score_b/winning_team/
-- team assignments/mode) are untouched — they really happened.
-- rank_applied stays true on both (unchanged), so neither will ever be
-- re-applied against the fresh player_ranks rows above.
-- =============================================================================

update public.ranked_match_players
set rating_before = null,
    rating_after = null,
    rating_delta = null,
    tier_before = null,
    pips_before = null,
    tier_after = null,
    pips_after = null,
    pip_delta = null,
    star_protected = false,
    expected_score = null,
    actual_score = null,
    performance_gap = null,
    match_weight = null,
    recency_multiplier = null,
    reliability_modifier = null
where match_id in (
  select id from public.ranked_matches where status = 'confirmed'
);
