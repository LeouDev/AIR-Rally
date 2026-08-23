-- events.booking_id / court_id / venue_id / start_time / end_time are
-- validated on INSERT (the check clause confirms the booking belongs to the
-- caller and matches the court) but NOT re-validated on UPDATE — the UPDATE
-- policy is just (auth.uid() = creator_id) OR is_admin(), no column
-- restriction at all. Verified live: an event's creator can UPDATE their own
-- event to point booking_id and court_id at ANOTHER USER'S booking and a
-- different court entirely, and it succeeds.
--
-- This is the orphaned-game harm from 078 arriving by a different route:
-- players join an event that, after a re-point, no longer corresponds to any
-- court reservation the creator actually holds. They travel, and there is
-- nothing there.
--
-- SCOPE, DECIDED RATHER THAN GUESSED: grepped every UPDATE call site against
-- events in BOTH client repos. There is exactly one — cancelEvent(), which
-- touches ONLY status. No "edit event" feature exists in either app. So the
-- design question the founder's "ownership" category actually asks is
-- narrow: which columns together describe "which real reservation does this
-- event represent," not "lock the whole row." Title, description,
-- max_players, price_amount, skill_level and the rest stay freely editable
-- by the creator — nothing found protects those today and nothing here
-- changes that; a future "edit my event" feature touching them is a
-- legitimate product surface, not a security gap.
--
-- booking_id, court_id, venue_id, start_time and end_time are the exception:
-- together they ARE the reservation this event claims to represent, and
-- that claim is exactly what a player trusts when they join. Protected as a
-- set, not individually, because re-pointing just one (say court_id alone,
-- leaving venue_id stale) would be an equally dishonest state even though
-- no single column looks wrong in isolation.
--
-- THE ONE LEGITIMATE WRITER of these columns is sync_event_on_booking_cancel()
-- (20260810000078), which re-points exactly this set when a reschedule gives
-- an event a confirmed replacement booking. It needs a bypass, the same
-- shape as every other guard added today — set immediately before its own
-- UPDATE, reset immediately after, so it can never linger into an unrelated
-- later statement in the same transaction (the exact bug caught and fixed in
-- 20260810000081's first draft).
--
-- No is_admin() exemption, same reasoning as 081: these are brand new
-- guards on columns nothing protected before, so there is no existing admin
-- flow to preserve, and no established need for an admin to freely
-- re-point someone's event at an arbitrary booking.
--
-- NO BACKFILL. If an existing event's reservation columns were already
-- re-pointed before this landed, we have no way to know what they should
-- honestly be, and inventing a value would be worse than leaving the row
-- as it is. Same reasoning as every backfill decision today.

create or replace function public.prevent_event_reservation_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('air_rally.bypass_event_reservation_tampering', true), 'false') = 'true' then
    return new;
  end if;

  if new.booking_id is distinct from old.booking_id then
    new.booking_id := old.booking_id;
  end if;
  if new.court_id is distinct from old.court_id then
    new.court_id := old.court_id;
  end if;
  if new.venue_id is distinct from old.venue_id then
    new.venue_id := old.venue_id;
  end if;
  if new.start_time is distinct from old.start_time then
    new.start_time := old.start_time;
  end if;
  if new.end_time is distinct from old.end_time then
    new.end_time := old.end_time;
  end if;

  return new;
end;
$$;

-- Named to sort AFTER events_notify_on_cancelled and events_prevent_count_tampering
-- alphabetically ("prevent_reservation_tampering" > "notify_on_cancelled",
-- > "prevent_count_tampering") — deliberate, though not load-bearing here:
-- this trigger and the two existing ones touch fully disjoint columns
-- (reservation columns vs. status/participant_count), so there is nothing
-- for the ordering to actually decide. Documented anyway rather than left
-- to accident, matching today's own standard for this table's sibling
-- (event_attendees).
create trigger events_prevent_reservation_tampering
before update on public.events
for each row execute function public.prevent_event_reservation_tampering();

-- sync_event_on_booking_cancel() (078) is the one legitimate writer of these
-- columns — re-declared here with the bypass added; everything else is
-- unchanged from 078.
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

  select b.id, b.start_time, b.end_time, b.court_id
    into v_replacement
  from public.booking_reschedules br
  join public.bookings b on b.id = br.new_booking_id
  where br.original_booking_id = new.id
    and br.status <> 'failed'
    and b.status = 'confirmed'
  order by br.created_at desc
  limit 1;

  for v_event in
    select * from public.events
    where booking_id = new.id and status not in ('cancelled', 'completed')
  loop
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

      perform set_config('air_rally.bypass_event_reservation_tampering', 'true', true);
      update public.events
      set booking_id = v_replacement.id,
          court_id   = v_replacement.court_id,
          start_time = v_replacement.start_time,
          end_time   = case when v_event.end_time is null then null else v_replacement.end_time end
      where id = v_event.id;
      perform set_config('air_rally.bypass_event_reservation_tampering', 'false', true);

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
      update public.events
      set status = 'cancelled',
          cancellation_reason = 'booking_cancelled'
      where id = v_event.id;
    end if;
  end loop;

  return new;
end;
$$;
