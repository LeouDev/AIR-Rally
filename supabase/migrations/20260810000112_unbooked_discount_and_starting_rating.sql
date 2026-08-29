-- Two founder-approved changes, shipped together because both touch
-- player_ranks and a player's first experience: the calibrated-unbooked
-- freeze becomes a discount, and new players start at 1100 instead of
-- 1000. Testing them as one change is cleaner than two migrations days
-- apart.
--
-- ============================================================================
-- 1. THE FREEZE BECOMES A DISCOUNT
-- ============================================================================
--
-- 20260810000100's freeze made a calibrated player's unbooked match count
-- for nothing: no rating movement, no win/loss, no streak, no calibration
-- progress, no ranked_match_players row. That rule blocks 100% of players
-- today, because nothing is bookable — the reward for finishing
-- calibration was a locked door, on a platform with 21 users and zero
-- matches played.
--
-- It can't simply be removed, though — that comment's own reasoning still
-- holds: a booking is proof a match happened, something a player cannot
-- set for themselves because it requires paying. Remove the rule entirely
-- and two friends can fabricate matches and climb. The discount keeps
-- that cost; it just stops it being infinite.
--
-- The shape: multiply the rating delta by 0.5 when the match wasn't
-- booked and the player was already calibrated coming into it. Nothing
-- else is special-cased — every "proceeds normally" item (wins, losses,
-- streak, reliability, calibration_matches, the ranked_match_players row)
-- was already written to key off v_rank.is_calibrated or nothing at all,
-- so removing the freeze's early `continue` is what makes them normal
-- again, not new code. booked_rated_matches was already conditioned on
-- v_booked alone and needs no change: it only ever counted booked
-- matches, discount or not.
--
-- The one thing the freeze's v_frozen array did that still needs doing
-- is telling a player, in their result notification, that this match
-- moved them at half rate. Rather than keep a parallel array for that
-- alone, this reads it back off something already persisted:
-- ranked_match_players.tier_before is set to `case when v_rank.is_calibrated
-- then v_old_tier end` — NULL if and only if the player was NOT calibrated
-- before this match (player_ranks.tier is NOT NULL by constraint, so
-- "tier_before is null" can only ever mean "wasn't calibrated yet", never
-- a null tier value slipping through). So `not v_booked and tier_before is
-- not null` identifies exactly the discounted players at the final
-- notification step, with no array and no extra bookkeeping — reading a
-- PRE-match column also means a player who becomes calibrated ON this
-- exact match is correctly never flagged as discounted, which a
-- post-update read of is_calibrated would have gotten wrong.
--
-- ============================================================================
-- 2. STARTING RATING 1000 -> 1100
-- ============================================================================
--
-- 1000 is the exact floor of Driver (the tier above the bottom, Dinker),
-- so a single early loss drops a brand-new player a whole tier into the
-- basement. 1100 is mid-Driver, so ordinary variance keeps them in the
-- tier they started in. The tier FLOORS are not moving — Driver's floor
-- stays 1000, same as every other tier boundary in ranked_rank_for_aar()
-- (20260810000068) — only where a new player's rating starts within that
-- fixed scale changes.
--
-- The value is hand-duplicated in three places, all confirmed at 1000
-- before this migration: this column's default, web's RATING_STARTING_VALUE
-- (src/lib/rating.ts), and mobile's RATING_STARTING_VALUE (src/lib/ranked.ts).
-- All three change together here — the DB column in this migration, both
-- client constants in the same commit/PR as this file. This is a real
-- instance of the same hand-duplication risk the type files and the stale
-- `mode` column already showed this week (a value copied by hand into
-- more than one place, nothing checking they agree) — worth naming even
-- though this particular trio happened to already agree, since the NEXT
-- one might not be caught before it ships.
--
-- EXISTING ROWS ARE NOT REBASED. Four player_ranks rows exist on
-- production today (1000, 1000, 1006, 994) and none of them move — this
-- only changes what a BRAND NEW row starts at. Do not "fix" the
-- inconsistency between old and new players' starting points; it is the
-- expected, permanent shape of changing a default going forward.
-- ============================================================================

begin;

alter table public.player_ranks
  alter column rating set default 1100;

create or replace function public.apply_ranked_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_calibration_matches constant integer := 10;
  c_unbooked_discount constant numeric := 0.5;

  v_match public.ranked_matches%rowtype;
  v_booked boolean;
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

  v_booked := public.ranked_match_is_booked(p_match_id);

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
    -- The discount: a calibrated player's unbooked match still moves
    -- their rating, just at half the usual size. An uncalibrated player
    -- is never discounted, booked or not — see this migration's header.
    v_raw_delta := v_k * v_gap * v_weight * v_reliability_mod * v_recency
      * (case when not v_booked and v_rank.is_calibrated then c_unbooked_discount else 1 end);
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
          order by m2.confirmed_at desc nulls last
          limit 10
        ) recent
        where recent.expected_score < 0.4 and recent.won
      )
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
        booked_rated_matches = booked_rated_matches + (case when v_booked then 1 else 0 end),
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

  -- Per-player messaging. A discounted player's rating DID move, just at
  -- half rate — tier_before is null exactly for a player who wasn't
  -- calibrated before this match (player_ranks.tier is NOT NULL by
  -- constraint, so this is never a null-tier accident), which is what
  -- lets this be read back here with no tracking array.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_result_confirmed', 'Result confirmed',
         case when not v_booked and p.tier_before is not null
           then 'All players accepted ' || v_match.score_a || '–' || v_match.score_b ||
                '. Recorded — counts at half because this match was not at a booked court. Book a court to move at full rate.'
           else 'All players accepted ' || v_match.score_a || '–' || v_match.score_b || '. Ratings applied.'
         end,
         '/ranked/match/' || p_match_id
  from public.ranked_match_players p
  where p.match_id = p_match_id;
end;
$$;

commit;
