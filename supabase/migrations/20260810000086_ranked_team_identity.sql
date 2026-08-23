-- Doubles team identity — founder's design review: "If playing in
-- doubles, players should be able to nominate team Name or select their
-- club name." / "That's okay, they can use funny name/or select their
-- own club name" (read as: free text, OR a club the SETTER themselves
-- belongs to — not requiring the whole team to be members; the AI CTO
-- confirmed this reading with the founder before this was built).
--
-- WHERE THIS LIVES: four columns on ranked_matches, not a new table. A
-- team here isn't a persistent entity — create_ranked_match() forms
-- team_a/team_b fresh from whoever's named every time, and this table
-- already denormalizes every other per-side fact as _a/_b suffixed
-- columns (score_a/score_b) rather than a side table. This is that same
-- convention, not a new one.
--
-- NAME OR CLUB, NEVER BOTH: club_id is a live FK, resolved by JOIN at
-- read time — if a club renames itself, every match that chose it should
-- read the new name, not a copy frozen at selection time. Free text has
-- no such backing and is exactly that: plain text, checked at up to 40
-- characters (a UI/scoreboard-label judgment, narrower than clubs.name's
-- own 80-character bound, accepted as-is). ON DELETE SET NULL on both
-- club_id columns — a deleted club falls back to no chosen identity,
-- never deletes match history.
--
-- WHO SETS IT, AND WHEN: set_ranked_team_identity() below. Caller must
-- be one of the two players actually on that team (checked against
-- ranked_match_players, same shape set_ranked_ready already uses), and
-- only while the match is still in 'lobby' — same gate set_ranked_ready
-- itself enforces ("This match has already left the lobby"), so identity
-- is locked in exactly when the roster itself locks in. Choosing a club
-- requires the SETTER to be an active member (club_role_of(), the same
-- helper clubs' own RLS uses) — not every player on the team, since a
-- doubles pair with one member and one guest partner is a normal case a
-- stricter rule would needlessly block. No unanimous vote: unlike
-- propose_ranked_officiating (where getting it wrong lets someone
-- unfairly control scoring), a team name is cosmetic — last-write-wins
-- between teammates, the same simplicity set_ranked_ready itself already
-- has.
--
-- MODERATION: 'ranked_match' added to reports.target_type — a team name
-- is user-generated content every other participant (and, once
-- confirmed, the public) can see, so it falls under the same reporting
-- surface as posts/comments/clubs/events/users, reported by the match's
-- own id like every other target_type already is.
--
-- ADDITIVE AND NULLABLE, BUT CONFIRM RATHER THAN ASSUME: every new
-- column is nullable with no new NOT NULL default, so an old client
-- reading/writing ranked_matches through its existing shape should
-- tolerate this migration with no schema-shaped failure — unlike
-- 20260810000085, which changes column sets clients actively filter on.
-- Verified, not just claimed: this migration's own check re-runs
-- create_ranked_match() and apply_ranked_result() exactly as an old
-- client would call them (no new arguments, no awareness these columns
-- exist) and confirms both still succeed unchanged.
--
-- ZERO OBJECT OVERLAP WITH 20260810000085: this touches ranked_matches
-- (new columns), reports (a CHECK constraint value), and one new RPC —
-- none of player_ranks, apply_ranked_result, ensure_player_rank,
-- ranked_party_spread, or ranked_leaderboard. Filed as its own migration
-- for exactly that reason: 085 already has a proven positive control,
-- and bundling an unrelated, freshly-written change into that file would
-- force re-proving 085 alongside it for no reason. 085 lands before or
-- with this migration, never after — sequencing is the AI CTO's call.

alter table public.ranked_matches
  add column team_a_name text check (team_a_name is null or char_length(team_a_name) between 1 and 40),
  add column team_a_club_id uuid references public.clubs (id) on delete set null,
  add column team_b_name text check (team_b_name is null or char_length(team_b_name) between 1 and 40),
  add column team_b_club_id uuid references public.clubs (id) on delete set null,
  add constraint ranked_matches_team_a_identity_check check (team_a_name is null or team_a_club_id is null),
  add constraint ranked_matches_team_b_identity_check check (team_b_name is null or team_b_club_id is null);

comment on column public.ranked_matches.team_a_name is
  'Free-text team name team A nominated for this match, or null. Mutually exclusive with team_a_club_id — set_ranked_team_identity() enforces this at the RPC layer too, but the CHECK constraint is what actually guarantees it.';
comment on column public.ranked_matches.team_a_club_id is
  'Club team A chose to represent, or null. Resolved by JOIN, not copied — a club rename is reflected on every match that selected it.';

create or replace function public.set_ranked_team_identity(
  p_match_id uuid,
  p_team text,
  p_name text default null,
  p_club_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;
  if p_team not in ('a', 'b') then
    raise exception 'Unknown team.' using errcode = 'AR001';
  end if;
  if v_name is not null and p_club_id is not null then
    raise exception 'Pick a team name or a club, not both.' using errcode = 'AR001';
  end if;
  if v_name is not null and char_length(v_name) > 40 then
    raise exception 'Team name must be 40 characters or fewer.' using errcode = 'AR001';
  end if;

  select status into v_status from public.ranked_matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found.' using errcode = 'AR001';
  end if;
  if v_status <> 'lobby' then
    raise exception 'This match has already left the lobby.' using errcode = 'AR001';
  end if;

  if not exists (
    select 1 from public.ranked_match_players
    where match_id = p_match_id and user_id = v_caller and team = p_team
  ) then
    raise exception 'You are not on that team.' using errcode = 'AR001';
  end if;

  -- The setter must belong to the club they're naming the team after —
  -- not every player on the team, deliberately (see this migration's
  -- header). club_role_of() is the same helper clubs' own RLS uses, and
  -- it resolves against auth.uid() (the caller), which is exactly who
  -- this check is meant to gate.
  if p_club_id is not null and public.club_role_of(p_club_id) is null then
    raise exception 'You are not a member of that club.' using errcode = 'AR001';
  end if;

  if p_team = 'a' then
    update public.ranked_matches
    set team_a_name = v_name, team_a_club_id = p_club_id, updated_at = now()
    where id = p_match_id;
  else
    update public.ranked_matches
    set team_b_name = v_name, team_b_club_id = p_club_id, updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

revoke execute on function public.set_ranked_team_identity(uuid, text, text, uuid) from public, anon;
grant execute on function public.set_ranked_team_identity(uuid, text, text, uuid) to authenticated;

-- =============================================================================
-- Moderation: a team name/club choice is reportable, same mechanism as
-- posts/comments/clubs/events/users — by the match's own id, same as
-- every other target_type already is.
-- =============================================================================

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'club', 'event', 'user', 'ranked_match'));
