-- Casual Open Play results. Founder's requirement: a profile should show
-- total wins across BOTH casual and ranked play, which needed casual
-- games to have a result at all — previously "a feature, not a stat."
-- Their own decisions, from an explicit multiple-choice: someone records
-- the result, everyone on the roster must confirm it; the result is
-- winner AND final score; anyone can dispute, and a disputed result
-- stays visible in history marked disputed but counts toward nobody's
-- total.
--
-- REUSE, NOT A PARALLEL SYSTEM: every one of those three decisions is
-- already exactly what the ranked match flow does —
-- submit_ranked_result()/respond_ranked_result()'s unanimous-acceptance
-- gate IS "someone records, everyone confirms"; respond_ranked_result's
-- dispute path already leaves the match at status='disputed', a real
-- visible row, already excluded from anything that only counts
-- status='confirmed' matches. None of that is new here. A casual game is
-- a ranked_matches row with rated = false, struck inside an Open Play
-- event via the event_id column that already exists for exactly this
-- ("a ranked match is normally struck inside an Open Play session on a
-- booked court" — 20260810000067). events.max_players is uncapped, so
-- one Open Play session can host several separate games as separate
-- rows under the same event_id — nothing new needed there either.
--
-- THE MECHANISM IS DELIBERATELY BORING: a plain `rated boolean not null
-- default true` column, checked once at the top of apply_ranked_result,
-- skipping the ENTIRE per-player player_ranks mutation block when false.
-- Not a match_weight_type / weight-zero trick, which was floated and
-- traced through the actual function body and rejected: a weight of 0
-- zeroes the RATING delta, but apply_ranked_result unconditionally also
-- writes calibration_matches + 1, wins/losses, current_streak/
-- best_streak, reliability, last_match_at, and sandbag_risk_score, none
-- of which a weight of zero prevents. A casual game under that scheme
-- would have silently burned one of a player's ten calibration slots and
-- inflated their RANKED win count while the rating itself sat still and
-- looked correct — nobody would have noticed until a player asked why
-- they were 8 of 10 calibrated having played five ranked matches.
-- Rating staying flat is not the same as the match not counting. The
-- explicit early-out is not the clever fix; it is the obvious one, and
-- correct beats clever here precisely because the next person reading
-- this function should not have to trace arithmetic to know what's
-- excluded.
--
-- THE SANDBAG WINDOW EXCLUDES CASUAL MATCHES FOR FREE, NOT BY DESIGN
-- HERE: its subquery already filters `mp2.performance_gap is not null`
-- (20260810000068) — a casual match's players never get performance_gap
-- written, because the whole per-player block that would write it is
-- skipped. Zero new filter code was added for this; it is a load-bearing
-- consequence of the skip-branch, worth knowing rather than
-- rediscovering.
--
-- ENSURE_PLAYER_RANK STILL RUNS for every player in a casual match — a
-- harmless side effect, not a bug to "fix" later: it bootstraps a
-- default, permanently-untouched player_ranks row for someone who may
-- never play a rated match. That row sits at its default forever unless
-- they actually do, since the skip-branch above means nothing ever
-- writes to it from a casual result.
--
-- SERVER IS THE AUTHORITY, NOT THE CLIENT — the founder's own words:
-- "Do not rely only on the frontend. The backend/database/business
-- logic must enforce this as well." This already holds by construction,
-- not by anything new added here: ranked_matches has had zero client
-- INSERT/UPDATE grants since 20260810000067 ("no client role gets
-- insert/update on any table here... every mutation goes through a
-- SECURITY DEFINER function") — only create_ranked_match() ever writes
-- `rated`, only at creation, and no function anywhere ever updates it
-- afterward. apply_ranked_result() reads the STORED value off the match
-- row it already holds a lock on; it is never passed a rated flag as an
-- argument, so there is no "the client forgot to pass p_rated=false"
-- failure mode at the one moment that actually matters. A client can
-- only influence `rated` once, at creation, the same way `match_type`
-- already can only be chosen once and never overridden later.
--
-- "Unconfirmed casual games do not count as completed results. We should
-- NOT invent, automatically assume, or inflate results just to make the
-- statistics look complete." — the founder's own words, and it is
-- already exactly how status='confirmed' has always worked: a lobby/
-- officiating/live/awaiting_confirmation/disputed/cancelled match is
-- simply not counted by anything that filters on 'confirmed'. Nothing
-- new needed to honor this either — naming it so the incompleteness
-- reads as a deliberate product property, not a gap.
--
-- COMBINED WINS LIVE IN A VIEW, NOT A CACHED COLUMN — this codebase's
-- own established convention (update_post_like_count(),
-- update_venue_rating_stats(), and player_ranks itself all recompute
-- from source rather than trust an incremented counter). player_ranks.
-- wins/losses stay RANKED-ONLY, untouched by this migration — that
-- number already means something specific and collapsing it with casual
-- results would make it wrong. player_match_totals below is the new,
-- genuinely different, broader number: every confirmed match, rated or
-- not.
--
-- SEQUENCING: after 20260810000085 for a real reason, not a cosmetic
-- one — create_ranked_match() and apply_ranked_result() both need new
-- bodies here (p_rated parameter, the skip-branch), and both must be
-- based on 085's bodies, not the original 067/068 ones, since this
-- redeclares the same two functions 085 already redeclared. No real
-- dependency on 20260810000086 — that migration never touched either
-- function, only added unrelated columns to the same table — numbered
-- after it for sequencing tidiness, not because anything requires it.
--
-- A VERIFICATION LESSON WORTH KEEPING WITH THE MIGRATION IT CAME FROM:
-- the first verification pass for the create_ranked_match drop above
-- (see that comment) reported PASS on "the old 5-argument call still
-- rejects an oversized party spread" — and the call genuinely DID fail,
-- just not for that reason. It failed with "function ... is not unique",
-- a Postgres overload-ambiguity error, because the old 5-arg signature
-- hadn't actually been dropped yet in that draft. A negative test that
-- only asserts "an error was thrown" cannot tell a real guard working
-- from the function being broken in an unrelated way — both look like
-- PASS. The fix was checking the error MESSAGE, not just its presence.
-- Standing rule from here on: every negative test in this codebase's
-- verification scripts must assert which error it got, not merely that
-- one occurred.
--
-- HELD, like 085 and 086: design, write, verify on staging — nothing
-- applied to production until Apple resolves build 9's review.

alter table public.ranked_matches
  add column rated boolean not null default true;

comment on column public.ranked_matches.rated is
  'False for a casual Open Play result: winner/score are recorded and confirmed exactly like a ranked match (same officiating/scoring/dispute flow), but apply_ranked_result() skips every player_ranks mutation entirely — no rating change, no calibration-match consumed, no ranked win/loss counted. Set once at creation by create_ranked_match(); nothing ever updates it afterward, and no client role has write access to this table at all (see this migration''s header) — the server is the sole authority on whether a match counts toward rating, matching the founder''s explicit requirement.';

-- =============================================================================
-- Creating a match — new p_rated parameter, defaulted true so an old
-- client's existing 5-argument call still produces exactly today's
-- behavior (a rated match). The party-spread cap is skipped entirely for
-- an unrated match: casual play is exactly where a strong and weak
-- player deliberately pair up, and the 250 AAR cap exists to keep a
-- RATED measurement meaningful, not to gatekeep who can play together
-- for fun.
-- =============================================================================

-- Explicit drop first: adding a trailing parameter does NOT replace the
-- existing 5-argument function in place — Postgres identifies a function
-- by its full parameter TYPE list, so (text, uuid[], uuid[], uuid, uuid)
-- and (text, uuid[], uuid[], uuid, uuid, boolean) are two DIFFERENT
-- signatures, not one signature with an added default. Without this
-- drop, both would coexist, and any call supplying fewer than 5
-- explicit arguments (every call in this codebase, since event_id/
-- court_id are almost always left to their defaults) becomes AMBIGUOUS
-- — "function is not unique" — because either overload could equally
-- fill the missing arguments from its own defaults. Caught by actually
-- running the old-style call against the new schema, not assumed: the
-- first version of this migration omitted this drop on the reasoning
-- that a trailing default parameter doesn't create a new overload, and
-- that reasoning was wrong — verified wrong by the exact ambiguity error
-- above, not just suspected.
drop function if exists public.create_ranked_match(text, uuid[], uuid[], uuid, uuid);

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

  foreach v_user_id in array v_all loop
    perform public.ensure_player_rank(v_user_id);
  end loop;

  -- Skipped entirely for an unrated (casual) match — see this
  -- migration's header for why this cap belongs to rated play only.
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
  values (v_season, p_event_id, p_court_id, v_venue_id, p_match_type, v_caller, p_rated)
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

revoke execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) from public, anon;
grant execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) to authenticated;

-- =============================================================================
-- The rating engine — one new early-out at the top, otherwise byte-for-
-- byte identical to 20260810000085's body. See this migration's header
-- for why an explicit `not v_match.rated` branch is correct and a
-- weight-based trick is not.
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

  -- Casual (unrated) result: the game happened, everyone confirmed it,
  -- but NOTHING about any player's rating standing is touched — no
  -- rating, no tier/pips, no calibration progress, no ranked win/loss,
  -- no streak, no reliability, no sandbag signal. Only the match itself
  -- is marked confirmed, so it shows in history and counts toward the
  -- combined win total (player_match_totals, below) — never toward
  -- player_ranks.
  if not v_match.rated then
    update public.ranked_matches
    set status = 'confirmed', rank_applied = true, confirmed_at = now(), updated_at = now()
    where id = p_match_id;

    insert into public.notifications (user_id, type, title, message, link_url)
    select p.user_id, 'ranked_result_confirmed', 'Result confirmed',
           'All players accepted ' || v_match.score_a || '–' || v_match.score_b || '. Result recorded.',
           '/ranked/match/' || p_match_id
    from public.ranked_match_players p
    where p.match_id = p_match_id;

    return;
  end if;

  -- Team strength is the mean of its players' rating — unchanged from
  -- 20260810000085.
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
-- Combined win total — a view, not a cached counter, matching this
-- codebase's own recompute-from-source convention. Every confirmed
-- match, rated or not; a disputed match is excluded automatically
-- because it never reaches status='confirmed'.
-- =============================================================================

create view public.player_match_totals
with (security_invoker = true)
as
select
  mp.user_id,
  count(*) as total_matches,
  count(*) filter (where m.winning_team = mp.team) as wins,
  count(*) filter (where m.winning_team is distinct from mp.team) as losses
from public.ranked_match_players mp
join public.ranked_matches m on m.id = mp.match_id
where m.status = 'confirmed'
group by mp.user_id;

grant select on public.player_match_totals to anon, authenticated;
