-- Nothing sweeps ranked matches. A match stuck at `lobby` or
-- `officiating` lives forever — the founder has one on their own phone
-- right now, permanently occupying the resume card. Every scheduled job
-- in this schema is bookings or settlements; none touches ranked.
--
-- ============================================================================
-- WHY THIS MARKS THEM `cancelled` AND NOT A NEW `expired` STATUS
-- ============================================================================
--
-- A new enum value would CRASH every currently-shipped client.
--
-- Both mobile switches on `ranked_matches.status` have no `default:` case:
--   * matchStatusLabel()          returns undefined for an unknown status
--   * app/ranked/[matchId].tsx    the COMPONENT returns undefined, which
--                                 React treats as "Nothing was returned
--                                 from render" and throws
--
-- Users today run build 9 (shipped 2026-08-23), which cannot know a value
-- invented now. The first player to open a swept match would get a crash
-- rather than an explanation.
--
-- THE GENERAL RULE, worth carrying beyond this migration: a new COLUMN is
-- invisible to old clients; a new ENUM VALUE breaks them. Old clients
-- ignore fields they never selected. They cannot ignore a value they
-- switch on. (This is the exact inverse of the `mode`-column incident,
-- where a column that VANISHED broke a client still selecting it.)
--
-- So: `status = 'cancelled'`, which every shipped client already renders
-- correctly and truthfully ("This match was cancelled — nothing was
-- recorded against anyone's rank"), plus a nullable `expired_at` marking
-- that it was swept rather than chosen by a person. The distinction the
-- history needs survives in the data; a later build can read the column
-- and say "expired" specifically. A real `expired` status stays possible
-- later, once a build that handles it is in the field.
--
-- ============================================================================
-- WHAT IS SWEPT, AND THE ONE RULE THAT IS NOT A TIMER
-- ============================================================================
--
--   lobby                 > 1 hour    nobody committed anything. Matches the
--                                     open-match design's own 1h expiry so the
--                                     two behave consistently.
--   officiating           > 2 hours   everyone readied, nothing started.
--   live                  > 24 hours  AND ONLY IF NO RALLIES RECORDED — see below
--   awaiting_confirmation NEVER       the match was PLAYED and the score
--                                     SUBMITTED. Only an accept is missing.
--                                     Sweeping destroys a real result and a
--                                     real rating change. A nudge is separate
--                                     machinery and deliberately not built here.
--   confirmed/disputed/cancelled      terminal, never touched.
--
-- `live` is swept on ABSENCE OF INVESTMENT, not on age. A live match with
-- zero rows in ranked_match_points is ABANDONED — someone tapped through
-- officiating and walked away. A live match with eight rallies is
-- INTERRUPTED, and deleting it destroys real scoring work exactly the way
-- sweeping `awaiting_confirmation` would. Age alone cannot tell those
-- apart; the rally count can. A game genuinely in progress on court
-- always has rallies, so this takes the risk of killing a real match to
-- zero rather than trading it against a chosen number.
--
-- ============================================================================
-- WHY THIS DOES NOT NOTIFY
-- ============================================================================
--
-- The email webhook has NO recipient-side gate. Unlike the push trigger,
-- which no-ops when the recipient has no device token, the email path
-- fires once per notification row and decides at the far end — measured
-- 2026-08-30: 95 calls, every one returning {"emailed":false}, purely
-- because no ranked notification type is currently email-eligible.
--
-- A bulk sweep is exactly the shape that becomes bulk email the day
-- someone makes a ranked type email-eligible, and that person will not be
-- thinking about a cron job they have never read. The value is also
-- lowest where the volume is highest: an abandoned lobby nobody joined is
-- not news. The actual complaint — a stale match occupying the resume
-- card forever — is fixed by the sweep itself.
--
-- If a future version sweeps matches that DO represent real work, revisit
-- this: someone who scored 8-6 and lost their phone deserves to be told.
-- Under the rally rule above, no such match is swept, so that case does
-- not arise today.
-- ============================================================================

begin;

alter table public.ranked_matches
  add column if not exists expired_at timestamptz;

comment on column public.ranked_matches.expired_at is
  'Set by expire_stalled_ranked_matches() when a match was swept for '
  'inactivity rather than cancelled by a person. status is ''cancelled'' in '
  'both cases deliberately — a new enum value would crash shipped clients '
  'whose status switches have no default case. Null on a human cancellation.';

create or replace function public.expire_stalled_ranked_matches(
  p_lobby_minutes integer default 60,
  p_officiating_minutes integer default 120,
  p_live_minutes integer default 1440
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stalled as (
    select m.id
    from public.ranked_matches m
    where
      (
        (m.status = 'lobby'       and m.created_at < now() - make_interval(mins => p_lobby_minutes))
        or
        (m.status = 'officiating' and m.created_at < now() - make_interval(mins => p_officiating_minutes))
        or
        (
          m.status = 'live'
          and coalesce(m.started_at, m.created_at) < now() - make_interval(mins => p_live_minutes)
          -- The rule that is not a timer: zero rallies means abandoned.
          -- A match with recorded points is interrupted, not abandoned,
          -- and is left alone exactly like awaiting_confirmation.
          and not exists (
            select 1 from public.ranked_match_points p where p.match_id = m.id
          )
        )
      )
      -- Stated explicitly rather than relying on the branches above, so
      -- that a later edit adding a status cannot silently sweep a played
      -- result. awaiting_confirmation must never appear here.
      and m.status in ('lobby', 'officiating', 'live')
  )
  update public.ranked_matches m
  set status = 'cancelled',
      expired_at = now(),
      updated_at = now()
  from stalled s
  where m.id = s.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_stalled_ranked_matches(integer, integer, integer)
  from public, anon, authenticated;

create extension if not exists pg_cron;

-- Every 15 minutes. The windows are hours, so a tighter cadence buys
-- nothing; cron.schedule() upserts by job name, so re-running this
-- migration updates the job rather than duplicating it.
select cron.schedule(
  'expire-stalled-ranked-matches',
  '*/15 * * * *',
  $$select public.expire_stalled_ranked_matches()$$
);

commit;
