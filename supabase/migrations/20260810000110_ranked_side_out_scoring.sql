-- Ranked scoring moves from rally scoring to traditional side-out
-- pickleball scoring, full doubles two-server rule. Founder decision
-- 2026-08-28: only the serving team can score; a receiving team that
-- wins a rally gets the serve, not a point. Doubles gets two servers
-- per side before a full side-out, except the game's opening service
-- turn, which gets one server only. Singles is standard side-out, no
-- server number.
--
-- record_ranked_point()'s own comment in 20260810000067 already said
-- "Side out: whoever scored serves next" — the comment described this
-- feature before the code did. This migration closes that gap.
--
-- THE HAZARD THIS MIGRATION IS BUILT AROUND: a match already in
-- progress when this ships has a point log written under rally
-- scoring. Replaying that log under side-out rules would retroactively
-- change a live score under the players mid-game — worse than the
-- crash this schema caused earlier this week. So the scoring rule is a
-- property of the MATCH ROW, not of the code: `scoring_mode` is added
-- via a two-step ALTER (backfill every existing/in-flight row to
-- 'rally' first, THEN flip the default to 'side_out' for new inserts
-- only — a single-step ALTER with the side_out default would have
-- flipped the founder's own in-flight matches). record_ranked_point()
-- and undo_ranked_point() branch on the row's own scoring_mode; the
-- 'rally' branch below is 20260810000067's body, byte-for-byte
-- unchanged (verified live via pg_get_functiondef before writing this),
-- so an existing match never enters the new code at all. A brand new
-- match's log always starts empty, so the new branch never has
-- anything retroactive to replay either. Do not ever change the rally
-- branch again — if rally scoring itself needs a fix, that fix belongs
-- in a new migration that everyone reads knowing exactly what it's
-- touching, not silently inside this one.

begin;

-- Backfills every existing row (including any match in progress right
-- now) to 'rally' — this statement runs before the default changes, so
-- it captures what those matches actually were.
alter table public.ranked_matches
  add column scoring_mode text not null default 'rally'
  check (scoring_mode in ('rally', 'side_out'));

-- Only matches created from this point on pick up 'side_out'.
alter table public.ranked_matches
  alter column scoring_mode set default 'side_out';

-- Denormalised side-out state, same role as the existing score_a/
-- score_b/serving_team columns: a cheap-to-read cache of what
-- ranked_match_points' log implies, recomputed on every point and
-- every undo rather than trusted as independently-writable state.
-- Both are meaningless (left at their defaults) for scoring_mode =
-- 'rally' rows and for singles matches.
alter table public.ranked_matches
  add column server_number smallint check (server_number in (1, 2)),
  add column first_service_turn_used boolean not null default false;

alter table public.ranked_matches
  add constraint ranked_matches_server_number_doubles_only
  check (server_number is null or match_type = 'doubles');

comment on column public.ranked_match_points.team is
  'Meaning depends on the owning match''s scoring_mode. Under ''rally'', '
  'this is the team that scored the point. Under ''side_out'', this is '
  'the team that WON THE RALLY, which only sometimes scores — see '
  'compute_side_out_state(). Do not assume "team = point scored" without '
  'checking the match''s scoring_mode first. (This table also has a '
  'SELECT policy reachable outside the app entirely — see '
  '"Participants and admins can view ranked match points" — so this '
  'warning has to live on the column, not just in application code.)';

-- Pure function: given the ordered list of rally winners for one match
-- and its match_type, returns the side-out state after all of them.
-- Called by both record_ranked_point (append one rally, recompute) and
-- undo_ranked_point (drop the last rally, recompute) — replay, not a
-- hand-patched increment/decrement, because side-out's state machine
-- (does this rally score; does serve rotate within the team or cross
-- the net; has the opening one-server exception been used yet) is
-- branchy enough that separate incremental logic in record and in undo
-- is exactly where a bug would hide. Undo of every case — including
-- un-consuming the opening exception — falls out of "replay one fewer
-- rally" for free, with no dedicated inverse logic.
--
-- Display note: the game's opening server is conventionally CALLED "2"
-- (there is no "first" server on the opening turn — that absence is
-- what makes losing it an immediate side-out). This function always
-- stores server_number = 1 for that turn; callers that render the
-- score must show "2" instead whenever first_service_turn_used is
-- false. Deliberately not stored as 2 — storing the called number
-- instead of the state would complicate every branch above for a
-- concern that belongs in display formatting, not in the fold.
create type public.ranked_side_out_state as (
  score_a smallint,
  score_b smallint,
  serving_team text,
  server_number smallint,
  first_service_turn_used boolean
);

create or replace function public.compute_side_out_state(p_rally_winners text[], p_match_type text)
returns public.ranked_side_out_state
language plpgsql
immutable
set search_path = public
as $$
declare
  v_state public.ranked_side_out_state;
  v_winner text;
  v_doubles boolean := p_match_type = 'doubles';
begin
  v_state.score_a := 0;
  v_state.score_b := 0;
  v_state.serving_team := 'a';
  v_state.server_number := case when v_doubles then 1 else null end;
  v_state.first_service_turn_used := false;

  foreach v_winner in array coalesce(p_rally_winners, '{}'::text[])
  loop
    if v_winner = v_state.serving_team then
      -- Serving team won the rally: they score. Nothing else changes —
      -- same server, same team, serve continues exactly as it was.
      if v_state.serving_team = 'a' then
        v_state.score_a := v_state.score_a + 1;
      else
        v_state.score_b := v_state.score_b + 1;
      end if;
    elsif not v_doubles then
      -- Singles: no second server to rotate through, so every lost
      -- rally is an immediate side-out. Winning the serve back is not
      -- itself a point.
      v_state.serving_team := v_winner;
    elsif not v_state.first_service_turn_used then
      -- The game's one-server opening turn: losing it is an immediate
      -- full side-out, and the exception is spent for the rest of the
      -- match — every side-out after this one goes through the normal
      -- two-server rotation below.
      v_state.serving_team := v_winner;
      v_state.server_number := 1;
      v_state.first_service_turn_used := true;
    elsif v_state.server_number = 1 then
      -- First server lost the rally; the second server takes over.
      -- Same team keeps serving.
      v_state.server_number := 2;
    else
      -- Second server also lost the rally: full side-out, serve
      -- crosses the net.
      v_state.serving_team := v_winner;
      v_state.server_number := 1;
    end if;
  end loop;

  return v_state;
end;
$$;

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
  v_state public.ranked_side_out_state;
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

  -- p_team means "the team that just won this exchange" under both
  -- modes — that's why this insert and this signature never had to
  -- change. What differs is what the two modes DO with that fact below.
  insert into public.ranked_match_points (match_id, seq, team, recorded_by)
  values (p_match_id, v_seq, p_team, v_caller);

  if v_match.scoring_mode = 'rally' then
    -- Unchanged since 20260810000067. Only a match created before
    -- side-out shipped can be in this branch — see this migration's
    -- header for why this body must never be touched again.
    update public.ranked_matches
    set score_a = score_a + (case when p_team = 'a' then 1 else 0 end),
        score_b = score_b + (case when p_team = 'b' then 1 else 0 end),
        serving_team = p_team,
        updated_at = now()
    where id = p_match_id;
  else
    select * into v_state
    from public.compute_side_out_state(
      (select array_agg(team order by seq) from public.ranked_match_points where match_id = p_match_id),
      v_match.match_type
    );

    update public.ranked_matches
    set score_a = v_state.score_a,
        score_b = v_state.score_b,
        serving_team = v_state.serving_team,
        server_number = v_state.server_number,
        first_service_turn_used = v_state.first_service_turn_used,
        updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

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
  v_state public.ranked_side_out_state;
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

  if v_match.scoring_mode = 'rally' then
    -- Unchanged since 20260810000067.
    select team into v_prev from public.ranked_match_points
    where match_id = p_match_id order by seq desc limit 1;

    update public.ranked_matches
    set score_a = score_a - (case when v_last.team = 'a' then 1 else 0 end),
        score_b = score_b - (case when v_last.team = 'b' then 1 else 0 end),
        serving_team = coalesce(v_prev, 'a'),
        updated_at = now()
    where id = p_match_id;
  else
    -- Side-out: replay what's left, from scratch. No dedicated undo
    -- logic — deleting the last rally and recomputing the whole state
    -- is what makes the opening exception, a server rotation, and a
    -- full side-out all undo correctly through the same code path.
    select * into v_state
    from public.compute_side_out_state(
      (select array_agg(team order by seq) from public.ranked_match_points where match_id = p_match_id),
      v_match.match_type
    );

    update public.ranked_matches
    set score_a = v_state.score_a,
        score_b = v_state.score_b,
        serving_team = v_state.serving_team,
        server_number = v_state.server_number,
        first_service_turn_used = v_state.first_service_turn_used,
        updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

commit;
