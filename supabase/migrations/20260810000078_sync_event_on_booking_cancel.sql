-- A cancelled booking used to leave its Open Play game published and
-- joinable. A player could join, travel to the venue, and find nothing
-- reserved — the organiser cancelled the booking, the game did not follow.
-- Live on production: one such event exists there today (past-dated, so
-- unreachable now, and no ranked match ever traced to one).
--
-- WHY A TRIGGER RATHER THAN THE CANCEL ENDPOINT
--
-- expire_stale_pending_bookings() sets status = 'cancelled' directly in
-- SQL on a five-minute cron and never touches an HTTP endpoint. A fix in
-- /api/mobile/cancel would therefore miss every expired booking — which is
-- exactly the organiser who created a game, walked away mid-checkout and
-- never came back, i.e. the most likely orphan of all. Reschedule and the
-- web cancel path are in-database too. Endpoint-level isn't less complete,
-- it's structurally incomplete. Three cancellation cascades already live
-- here (credit restore, reschedule reconcile, settlement reverse); this is
-- a fourth of the same kind, not a new pattern.
--
-- HOW IT DISTINGUISHES A RESCHEDULE FROM A REAL CANCELLATION
--
-- It doesn't ask. Rescheduling cancels the original booking, so a naive
-- cascade would kill the game every time an organiser moved their court
-- time — destroying something players had already joined, which is worse
-- than the bug being fixed.
--
-- Rather than signal intent (a cancellation_cause column every cancel path
-- must remember to set, or a session GUC that leaves no trace), this asks
-- about OUTCOME: does this booking have a live replacement? That derives
-- from facts already persisted, is auditable afterwards, and fails safe —
-- a half-completed reschedule with no confirmed replacement falls through
-- to cancel, which is the conservative direction.
--
-- The replacement must be CONFIRMED, not merely present. Consider: a user
-- books X, starts a reschedule to Y, then abandons it by cancelling X
-- directly. reconcile_reschedule_on_booking_cancel() marks the reschedule
-- 'failed' and Y stays 'pending' forever. Accepting a pending replacement
-- would re-point the game at a booking that will never confirm. Requiring
-- 'confirmed' makes that case correctly fall through to cancel.
-- complete_reschedule() confirms the replacement (its line 242) BEFORE
-- cancelling the original (line 252), so the confirmed state is already
-- true by the time this trigger runs.

alter table public.events
  add column if not exists cancellation_reason text;

comment on column public.events.cancellation_reason is
  'Why the event was cancelled, when it was cancelled by a cascade rather than by a '
  'person. Read by notify_on_event_cancelled() so the message can say the specific '
  'thing. Null for an ordinary organiser cancellation.';

-- ---------------------------------------------------------------------------
-- notify_on_event_cancelled — say the specific cause, and stamp a link_url
-- ---------------------------------------------------------------------------
-- Three changes. It now reads cancellation_reason so an attendee is told WHY
-- rather than getting the generic sentence. It stamps link_url, which it
-- never did: both clients prefer link_url over the notification type when
-- routing, and mobile has no type fallback for event_cancelled at all, so
-- every one of these taps currently lands on the Alerts tab instead of the
-- event. Fixing that here because this function is already open.
--
-- And the audience is widened to include 'pending_approval', which it never
-- was: 20260810000069 added that status for a non-creator's request awaiting
-- the organiser's decision, and never updated this function's filter. Left
-- as-is, someone whose join request is still pending would never be told
-- their event was cancelled — they'd be left waiting on a decision about a
-- game that no longer exists. Deliberate widening, not an incidental one.
create or replace function public.notify_on_event_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.notifications (user_id, type, title, message, link_url)
    select
      ea.user_id,
      'event_cancelled',
      'Event cancelled',
      new.title || case
        when new.cancellation_reason = 'booking_cancelled'
          then ' has been cancelled — the court booking behind it was cancelled.'
        else ' has been cancelled.'
      end,
      '/events/' || new.id
    from public.event_attendees ea
    where ea.event_id = new.id and ea.status in ('joined', 'waitlisted', 'pending_approval');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The cascade
-- ---------------------------------------------------------------------------
create or replace function public.sync_event_on_booking_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replacement record;
  v_event record;
  v_tz text;
  v_old text;
  v_new text;
begin
  if new.status <> 'cancelled' or old.status is not distinct from 'cancelled' then
    return new;
  end if;

  -- A live replacement, or nothing. 'failed' reschedules are excluded and
  -- the replacement must actually be confirmed — see the header.
  select b.id, b.start_time, b.end_time, b.court_id
    into v_replacement
  from public.booking_reschedules br
  join public.bookings b on b.id = br.new_booking_id
  where br.original_booking_id = new.id
    and br.status <> 'failed'
    and b.status = 'confirmed'
  order by br.created_at desc
  limit 1;

  -- Stated as "not already finished" rather than an allow-list of
  -- ('draft','published'): a status added to events_status_check later is
  -- then handled by default instead of silently falling through. Same
  -- reasoning as bookings_no_overlap's predicate in 20260810000076.
  for v_event in
    select * from public.events
    where booking_id = new.id and status not in ('cancelled', 'completed')
  loop
    if v_replacement.id is not null then
      -- ---- RE-POINT: the game follows the booking -------------------------
      -- Times are rendered in the VENUE's timezone, never UTC — a player
      -- reads "6:00pm" as local, and this app already had one revenue bug
      -- from assuming otherwise. A reschedule may move to a different court
      -- but is constrained to the SAME venue (reschedules.ts checks it), so
      -- the timezone is stable across the move.
      select coalesce(ev.timezone, cv.timezone, 'Asia/Manila')
        into v_tz
      from (select 1) _
      left join public.venues ev on ev.id = v_event.venue_id
      left join public.courts  c  on c.id  = v_event.court_id
      left join public.venues cv on cv.id = c.venue_id;

      v_old := to_char(v_event.start_time     at time zone v_tz, 'FMDy FMDD FMMon FMHH12:MI')
               || lower(to_char(v_event.start_time     at time zone v_tz, 'AM'));
      v_new := to_char(v_replacement.start_time at time zone v_tz, 'FMDy FMDD FMMon FMHH12:MI')
               || lower(to_char(v_replacement.start_time at time zone v_tz, 'AM'));

      update public.events
      set booking_id = v_replacement.id,
          court_id   = v_replacement.court_id,
          start_time = v_replacement.start_time,
          -- Preserve "this event has no end time" rather than inventing one.
          end_time   = case when v_event.end_time is null then null else v_replacement.end_time end
      where id = v_event.id;

      -- Carries BOTH times deliberately. There is no magnitude threshold —
      -- ten minutes matters to someone travelling an hour and three days
      -- doesn't matter to someone with an open calendar — so the message
      -- gives each person what they need to judge it themselves. Same
      -- widened audience as notify_on_event_cancelled, for the same reason:
      -- a pending_approval requester deserves to know the time moved before
      -- their request is even decided.
      insert into public.notifications (user_id, type, title, message, link_url)
      select
        ea.user_id,
        'event_moved',
        'Game time changed',
        v_event.title || ' moved from ' || v_old || ' to ' || v_new || '.',
        '/events/' || v_event.id
      from public.event_attendees ea
      where ea.event_id = v_event.id and ea.status in ('joined', 'waitlisted', 'pending_approval');

    else
      -- ---- CANCEL: no replacement, the game cannot happen -----------------
      -- Status, never delete: event_attendees is ON DELETE CASCADE, so a
      -- delete would wipe the attendees and leave events_notify_on_cancelled
      -- with nobody to tell. Setting the status fires that trigger, which is
      -- what informs everyone who had joined.
      update public.events
      set status = 'cancelled',
          cancellation_reason = 'booking_cancelled'
      where id = v_event.id;
    end if;
  end loop;

  return new;
end;
$$;

-- Named to sort LAST among the six AFTER UPDATE triggers on bookings, which
-- fire in alphabetical order:
--   bookings_create_settlement
--   bookings_notify_on_change
--   bookings_reconcile_reschedule_on_cancel
--   bookings_restore_credit_on_cancel
--   bookings_reverse_settlement
--   bookings_sync_event_on_cancel            <- this one
-- Deliberate: every existing piece of cancellation bookkeeping settles
-- before this reads booking_reschedules to decide what to do.
create trigger bookings_sync_event_on_cancel
after update on public.bookings
for each row execute function public.sync_event_on_booking_cancel();

-- ---------------------------------------------------------------------------
-- ONE-TIME BACKFILL — apply the same cascade retroactively
-- ---------------------------------------------------------------------------
-- A trigger only fires on FUTURE writes. Without this, any Open Play game
-- whose court booking was already cancelled before this migration first ran
-- stays exactly as broken as it was: published, joinable, pointing at a
-- booking that no longer exists. Confirmed concretely, not hypothetically —
-- on staging, an event cancelled before this trigger first existed there is
-- STILL 'published' and STILL passes the app's own browse filter
-- (status='published' and start_time in the future) today.
--
-- Deliberately folded into THIS migration rather than a follow-up: the fix
-- and its retroactive half must not be separable by anyone's memory later.
-- Forward-only is precisely the failure this backfill exists to close, so
-- shipping it as an afterthought would repeat the mistake it's fixing.
--
-- SCOPED TO FUTURE EVENTS ONLY (start_time >= now()). A past-dated orphan
-- already didn't happen; cancelling it now notifies attendees about a game
-- that's already over, which helps nobody and only adds noise. The harm
-- this closes is exclusively "someone can still join this" — a past event
-- can't be joined regardless of what its stored status says. Measured
-- before writing this, not guessed: as of the day this migration was
-- authored, production's own only such orphan is past-dated and would NOT
-- be touched by this block; staging's one genuine live orphan WOULD be.
--
-- Mirrors sync_event_on_booking_cancel()'s decision exactly (confirmed
-- replacement -> re-point; none -> cancel) rather than reusing it as a
-- shared function, so that already-verified trigger logic is not
-- restructured on the same day it first reaches production. Duplication
-- here is deliberate and bounded to a one-time operation, not a
-- maintained abstraction.
do $$
declare
  v_event record;
  v_replacement record;
  v_tz text;
  v_old text;
  v_new text;
  v_repointed int := 0;
  v_cancelled int := 0;
begin
  for v_event in
    select e.* from public.events e
    join public.bookings b on b.id = e.booking_id
    where b.status = 'cancelled'
      and e.status not in ('cancelled', 'completed')
      and e.start_time >= now()
  loop
    select b.id, b.start_time, b.end_time, b.court_id
      into v_replacement
    from public.booking_reschedules br
    join public.bookings b on b.id = br.new_booking_id
    where br.original_booking_id = v_event.booking_id
      and br.status <> 'failed'
      and b.status = 'confirmed'
    order by br.created_at desc
    limit 1;

    if v_replacement.id is not null then
      select coalesce(ev.timezone, cv.timezone, 'Asia/Manila')
        into v_tz
      from (select 1) _
      left join public.venues ev on ev.id = v_event.venue_id
      left join public.courts  c  on c.id  = v_event.court_id
      left join public.venues cv on cv.id = c.venue_id;

      v_old := to_char(v_event.start_time     at time zone v_tz, 'FMDy FMDD FMMon FMHH12:MI')
               || lower(to_char(v_event.start_time     at time zone v_tz, 'AM'));
      v_new := to_char(v_replacement.start_time at time zone v_tz, 'FMDy FMDD FMMon FMHH12:MI')
               || lower(to_char(v_replacement.start_time at time zone v_tz, 'AM'));

      update public.events
      set booking_id = v_replacement.id,
          court_id   = v_replacement.court_id,
          start_time = v_replacement.start_time,
          end_time   = case when v_event.end_time is null then null else v_replacement.end_time end
      where id = v_event.id;

      insert into public.notifications (user_id, type, title, message, link_url)
      select
        ea.user_id,
        'event_moved',
        'Game time changed',
        v_event.title || ' moved from ' || v_old || ' to ' || v_new || '.',
        '/events/' || v_event.id
      from public.event_attendees ea
      where ea.event_id = v_event.id and ea.status in ('joined', 'waitlisted', 'pending_approval');

      v_repointed := v_repointed + 1;
    else
      -- Direct UPDATE, not a call through any application path — this
      -- still fires events_notify_on_cancelled (an ordinary AFTER UPDATE
      -- trigger on the table, unconditioned on caller), so every affected
      -- attendee is told through the exact same machinery the live cascade
      -- uses. No separate notification insert needed for this branch.
      update public.events
      set status = 'cancelled',
          cancellation_reason = 'booking_cancelled'
      where id = v_event.id;

      v_cancelled := v_cancelled + 1;
    end if;
  end loop;

  raise notice 'backfill: % future event(s) re-pointed, % cancelled (booking already cancelled before this trigger existed)',
    v_repointed, v_cancelled;
end;
$$;
