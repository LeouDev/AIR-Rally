-- ---------------------------------------------------------------------------
-- Public, no-session match-result page.
--
-- Same shape as public_venue_request_summary() (migration 20260810000106):
-- one function, granted to anon AND authenticated, answering for exactly
-- one row the caller names and nothing else. The reader is the group chat,
-- the club, the friend without the app yet — someone a player just shared
-- a result with, who has never signed in and never will just to see a
-- score.
--
-- CONFIRMED ONLY. A live/lobby/officiating/awaiting_confirmation match is
-- in-progress state gated to participants (see ranked_matches' own SELECT
-- policy and /ranked/match/[matchId]'s SignInGate) — this function must
-- never leak any of that to an anonymous caller. Anything not 'confirmed'
-- reads as "no such match" here, same as RLS already treats a
-- non-participant on the authenticated route.
--
-- Players by display_name ONLY — no user_id, no avatar, no profile link.
-- "Names can be public for this, it's a sport" (the founder's own words),
-- but nothing else about the person.
--
-- Rating impact is DELIBERATELY ABSENT — no rating_delta, no tier_before/
-- tier_after, for anyone, on any row. A visitor sees the result, not what
-- it did to a player's standing. The one exception is `rated` itself: a
-- match-level boolean set once at creation (20260810000087), never derived
-- from a player's own delta, so exposing it carries none of the per-player
-- freeze risk below. It exists so a shared CASUAL result cannot read as a
-- ranked one to someone who does not know the difference — the page must
-- label it, not imply rating movement that never happened.
create or replace function public.public_ranked_match_summary(p_match_id uuid)
returns table (
  match_type text,
  score_a smallint,
  score_b smallint,
  winning_team text,
  rated boolean,
  confirmed_at timestamptz,
  venue_name text,
  players jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.match_type,
    m.score_a,
    m.score_b,
    m.winning_team,
    m.rated,
    m.confirmed_at,
    v.name,
    (
      select jsonb_agg(
               jsonb_build_object('displayName', coalesce(p.display_name, 'A player'), 'team', mp.team)
               order by mp.team, coalesce(p.display_name, '')
             )
      from public.ranked_match_players mp
      join public.profiles p on p.id = mp.user_id
      where mp.match_id = m.id
    ) as players
  from public.ranked_matches m
  left join public.venues v on v.id = m.venue_id
  where m.id = p_match_id
    and m.status = 'confirmed';
$$;

revoke all on function public.public_ranked_match_summary(uuid) from public, anon, authenticated;
grant execute on function public.public_ranked_match_summary(uuid) to anon, authenticated;
