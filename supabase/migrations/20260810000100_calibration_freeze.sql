-- ============================================================================
-- Freeze a calibrated player's rating in matches that are not behind a real
-- booking — record the match, do not move the ladder.
--
-- THE STRATEGY THIS SERVES. No venues are listed yet, so there is nothing to
-- book. Players can already complete the 10 calibration matches with no
-- booking (event_id, court_id and venue_id have always been optional), get
-- hooked on the ladder, and press their local venue to list.
--
-- WHY FREEZE RATHER THAN CUT OFF. A hard stop at match 10 churns the player
-- at the exact moment they cared most, and if their venue never lists they
-- can never play again. Freezing keeps the match in their history and their
-- rating still, with a visible route out: book a court to keep climbing.
--
-- THE MIXED LOBBY IS THE ACTUAL WORK. Player A has finished calibration;
-- player B has played three. They play each other, unbooked. For B it is a
-- genuine calibration match and must count. For A it must not. 087's `rated`
-- flag is per-MATCH and cannot express that — so this is decided PER
-- PARTICIPANT inside the loop that already exists in apply_ranked_result.
-- That loop is why this is a small change rather than a rewrite.
--
-- AND THE TRAP FROM LAST TIME: a weight-of-zero approach still incremented
-- calibration_matches, wins, losses and streaks. RATING STAYING FLAT IS NOT
-- THE SAME AS THE MATCH NOT COUNTING. A frozen player's row is skipped
-- outright — no rating, no calibration progress, no win/loss, no streak, no
-- reliability, no sandbag signal, and NO ranked_match_players row written, so
-- nothing downstream can read a zero and treat it as a result.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- WHAT "BOOKED" MEANS, AND WHY IT IS NOT venue_id.
--
-- ranked_matches has no booking_id. The only path to a real booking is
-- event_id -> events.booking_id -> bookings.
--
-- venue_id and court_id are NOT usable: create_ranked_match() takes
-- p_court_id from the client and derives venue_id from it with no check that
-- the caller has anything to do with that court. A player could name any
-- venue in the country. A freeze keyed on venue_id would be bypassable by
-- typing a uuid.
--
-- So: booked = there is a CONFIRMED booking behind the match's event. That is
-- something a player cannot set for themselves, because it requires paying.
-- ---------------------------------------------------------------------------
create or replace function public.ranked_match_is_booked(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ranked_matches m
    join public.events e on e.id = m.event_id
    join public.bookings b on b.id = e.booking_id
    where m.id = p_match_id
      and b.status = 'confirmed'
  );
$$;

-- ---------------------------------------------------------------------------
-- CLOSING THE HOLE THE FREEZE WOULD OTHERWISE INHERIT.
--
-- create_ranked_match() accepted p_event_id from the client and stored it
-- without checking the caller had any connection to that event. Before this
-- migration that was untidy; after it, it would be the bypass — attach
-- somebody else's booked event to your unbooked match and the freeze never
-- fires.
--
-- The caller must be the event's creator or one of its attendees. Anyone
-- else passing an event id now gets an error rather than a free rating.
-- ---------------------------------------------------------------------------
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
  v_match_id uuid;
  v_expected integer;
  v_all uuid[];
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

  -- NEW: an event id must be one the caller actually belongs to.
  if p_event_id is not null then
    if not exists (
      select 1 from public.events e
      where e.id = p_event_id
        and (
          e.creator_id = v_caller
          or exists (
            select 1 from public.event_attendees a
            where a.event_id = e.id and a.user_id = v_caller
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
  values (v_season, p_event_id, p_court_id, v_venue_id, p_match_type, v_caller, p_rated)
  returning id into v_match_id;

  insert into public.ranked_match_players (match_id, user_id, team, is_host, mode)
  select v_match_id, u, 'a', u = v_caller, p_match_type from unnest(p_team_a) u
  union all
  select v_match_id, u, 'b', u = v_caller, p_match_type from unnest(p_team_b) u;

  insert into public.notifications (user_id, type, title, message, link_url)
  select u, 'ranked_match_found', 'Ranked match found',
         'Your ranked match is ready.', '/ranked/match/' || v_match_id
  from unnest(v_all) u
  where u <> v_caller;

  return v_match_id;
end;
$$;

revoke execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) from public, anon;
grant execute on function public.create_ranked_match(text, uuid[], uuid[], uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- HOW MUCH OF A RATING WAS EARNED AT A BOOKED COURT.
--
-- A counter rather than a boolean flag, because a flag has to be maintained
-- in two directions and can fall out of step with the matches it describes.
-- "Provisional" is then derivable: calibrated, but zero booked rated matches
-- — a standing built entirely from games where two people agreed on a score
-- with nothing behind it.
--
-- DECIDED, NOT UNFINISHED. The founder was asked whether provisional ratings
-- should be hidden or gated from the ladder and said no: "they will still show
-- from the ladder but since they're not earning any rank they will stay
-- consistent with their rating." So a player who calibrated entirely on
-- unbooked matches appears at their frozen rating and stays there until they
-- book. They stay visible because they earned a place; the freeze keeps them
-- honest by holding the rating still rather than by removing them.
--
-- THIS COUNTER THEREFORE GATES NOTHING, ON PURPOSE. It is kept because it is
-- derivable rather than maintained, costs nothing, and is the only way anyone
-- could later answer "which ratings were built without a single booked match".
-- An ungated counter here is a decision, not a loose end.
--
-- KNOWN AND ACCEPTED PROPERTY, with an expiry. Two people can agree ten scores
-- and produce a rating. The freeze BOUNDS that — it cannot grow — but it does
-- not undo it, so a fabricated rating can sit on the ladder indefinitely at
-- whatever it calibrated to. Acceptable at launch: there is no credible ladder
-- to corrupt yet, making rank feel like it matters is the entire strategy, and
-- a frozen rating loses standing naturally as real players climb past it. It
-- STOPS being acceptable once the ladder is something people trust, and
-- booked_rated_matches is already here to address it with.
-- ---------------------------------------------------------------------------
alter table public.player_ranks
  add column if not exists booked_rated_matches integer not null default 0
  check (booked_rated_matches >= 0);

comment on column public.player_ranks.booked_rated_matches is
  'Rated matches this player completed behind a confirmed booking. '
  'is_calibrated AND booked_rated_matches = 0 means the rating is provisional: '
  'established entirely from unbooked play, which is two people agreeing a score.';

-- ---------------------------------------------------------------------------
-- The engine. Identical to 087 apart from the per-participant freeze, the
-- booked counter, and per-player result messaging.
-- ---------------------------------------------------------------------------
create or replace function public.apply_ranked_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_calibration_matches constant integer := 10;

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
  v_frozen uuid[] := '{}';
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

    -- ===== THE FREEZE =====
    -- Calibrated, and nothing was booked: this player's standing does not
    -- move. Note what is NOT here — no player_ranks update, no
    -- ranked_match_players update. Their row keeps its NULLs, and the
    -- absence of a rating_delta is the honest record that this match did
    -- not rate them. Writing a zero would be a number for something that
    -- did not happen, and the sandbag detector reads those columns.
    --
    -- The uncalibrated player in the SAME match falls through and is rated
    -- normally, consuming exactly one of their ten. That is the mixed
    -- lobby working: rated for whoever is still calibrating, frozen for
    -- whoever is not.
    if not v_booked and v_rank.is_calibrated then
      v_frozen := v_frozen || v_player.user_id;
      continue;
    end if;

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

  -- Per-player messaging. Telling a frozen player "Ratings applied" would be
  -- false, and telling them nothing leaves them to notice a rating that did
  -- not move and conclude the app is broken. The message names the reason and
  -- the way out — which is the entire point of freezing rather than blocking.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.user_id, 'ranked_result_confirmed', 'Result confirmed',
         case when p.user_id = any(v_frozen)
           then 'All players accepted ' || v_match.score_a || '–' || v_match.score_b ||
                '. Recorded — your rating stays put because this match was not at a booked court. Book a court to keep climbing.'
           else 'All players accepted ' || v_match.score_a || '–' || v_match.score_b || '. Ratings applied.'
         end,
         '/ranked/match/' || p_match_id
  from public.ranked_match_players p
  where p.match_id = p_match_id;
end;
$$;
