-- Persist WHETHER a player's rating movement was discounted, instead of
-- leaving the result screen to re-derive it.
--
-- 20260810000112 made a calibrated player's unbooked match move their
-- rating at half rate. The result screen and match history now need to
-- SAY that — but for an already-confirmed match, `rating_delta` is just
-- a number, and a small one is indistinguishable from a full-rate result
-- against a close opponent.
--
-- WHY NOT DERIVE IT CLIENT-SIDE. The obvious reconstruction is
-- "event_id/court_id are null, and tier_before is not null". Two things
-- are wrong with it. First, ranked_match_is_booked()'s own migration
-- (20260810000100) documents that a client can attach any court's uuid,
-- so those columns are not trustworthy input — and "the match is
-- confirmed now, so nobody can still be cheating" does not rescue it,
-- because the question is what v_booked evaluated to server-side AT
-- CONFIRMATION, not what the columns happen to hold afterwards. Second,
-- and more simply: booking state is only HALF the condition. The
-- discount also requires the player to have been calibrated coming into
-- the match, which no combination of match columns records.
--
-- So: write the fact down at the moment it is known, in the same UPDATE
-- that writes rating_delta, from the identical expression the multiplier
-- uses. This is the tier_before precedent (20260810000068) applied
-- again — that column exists because pre-match calibration state cannot
-- be recovered afterwards, and this is the same situation with the same
-- answer.
--
-- WHY ON ranked_match_players AND NOT ranked_matches. The condition is
-- `not booked AND this player was already calibrated` — so in a mixed
-- lobby, a calibrated player is discounted while their uncalibrated
-- opponent in the SAME match is not. That is the exact case
-- 20260810000100's own comment was written about. A per-match column
-- would be wrong, not merely coarse.
--
-- WHY NOT NULL DEFAULT false, RATHER THAN NULLABLE-MEANS-UNKNOWN. The
-- discount did not exist before 20260810000112, so no row written before
-- it can carry a halved delta: every pre-112 row was either rated at
-- full weight or not rated at all (20260810000100's freeze skipped the
-- UPDATE entirely, leaving rating_delta null). `false` is therefore
-- definitionally correct for existing rows, not an assumption about
-- them. Verified against production's four rows before choosing: two
-- cancelled with null deltas, two confirmed whose tier_before is null —
-- meaning both players were uncalibrated, and an uncalibrated player is
-- never discounted under either 100 or 112. Logic and data agree.
--
-- A nullable column would also have been worse in practice than in
-- principle: it forces every reader to handle "unknown", and the natural
-- shortcut (`if (row.rating_discounted)`) silently treats unknown as
-- not-discounted anyway. Honest in the schema, lossy at the call site.
--
-- Named for the fact, not the cause: what is recorded is that THIS
-- PLAYER's rating movement was reduced — not that the match was
-- unbooked, which is true for their uncalibrated opponent too and means
-- something different for them.
--
-- apply_ranked_result() is rebuilt from 20260810000112's body verbatim,
-- with two changes and no others: the new column is set in the existing
-- UPDATE, and the result notification now reads it directly instead of
-- reconstructing the same fact from `not v_booked and tier_before is not
-- null` as 112 had to before this column existed.

begin;

alter table public.ranked_match_players
  add column if not exists rating_discounted boolean not null default false;

comment on column public.ranked_match_players.rating_discounted is
  'True when this player''s rating_delta was halved because the match was '
  'not at a booked court and they were already calibrated (see '
  '20260810000112). Per-player, not per-match: a calibrated player can be '
  'discounted while their uncalibrated opponent in the same match is not. '
  'False on every row written before 20260810000112, definitionally — the '
  'discount did not exist yet, so nothing could halve a delta.';

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
        reliability_modifier = v_reliability_mod,
        -- The same expression the multiplier above uses, written down
        -- rather than left to be re-derived. One source, not two.
        rating_discounted = (not v_booked and v_rank.is_calibrated)
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
  -- half rate. Reads the decision straight off the row the loop above
  -- just wrote, rather than reconstructing it from tier_before as
  -- 20260810000112 had to before this column existed.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_result_confirmed', 'Result confirmed',
         case when p.rating_discounted
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
