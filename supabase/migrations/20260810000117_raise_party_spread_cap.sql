-- Founder decision, 2026-08-31, direct: "350 everywhere" — not a cap
-- specific to Open Match. The design memo's own line ("Rank gap cap
-- raised 250 -> 350 ARR") read as scoped to Open Match because it sits
-- in that section, and Open Match's own request_to_join_open_match
-- (20260810000116) was built against 350 on that reading. It was the
-- narrow reading — the founder's exact copy for the rejection ("You
-- cannot party/play with this player...") is generic party language,
-- not Open-Match-specific, which is what prompted asking directly
-- instead of leaving the scoping inferred.
--
-- This raises create_ranked_match's OWN cap — the existing party
-- builder, unrelated to Open Match — from 250 to 350, so the two paths
-- agree. Single-line change: `pg_get_functiondef` was pulled from the
-- live function first and only `c_max_party_spread` is touched, so
-- nothing else about this function's behavior moves.
--
-- Raising a cap is the safe direction: it only permits parties that
-- were previously refused, so nothing that worked before stops
-- working. That means, unlike Open Match's own RPCs (where client and
-- server must ship together — see 20260810000116's header), this one
-- does NOT need lockstep with the web/mobile clients: a client still
-- reading 250 simply refuses a party the server would now accept,
-- which is a missed convenience, not a broken one. Ship the clients
-- promptly anyway so the UI stops disagreeing with the server, but a
-- brief window of client-behind-server here is genuinely survivable,
-- not merely tolerated.
begin;

create or replace function public.create_ranked_match(p_match_type text, p_team_a uuid[], p_team_b uuid[], p_event_id uuid default null::uuid, p_court_id uuid default null::uuid, p_rated boolean default true)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_season smallint := public.current_ranked_season();
  v_match_id uuid;
  v_expected integer;
  v_all uuid[];
  v_venue_id uuid;
  v_user_id uuid;
  v_spread integer;
  c_max_party_spread constant integer := 350;
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
$function$;

commit;
