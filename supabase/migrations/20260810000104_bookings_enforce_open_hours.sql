-- ============================================================================
-- Enforce "the court is actually open" in the DATABASE, not only in the
-- service layer.
--
-- THE GAP. createBooking() calls is_court_time_bookable() before inserting, and
-- that function checks venue_operating_hours properly. But the check lives in
-- application code, and `bookings` is exposed through PostgREST with this as
-- its entire INSERT policy:
--
--     (auth.uid() = user_id)
--
-- No court check, no time check, no hours check. Verified against production on
-- 2026-08-27 by simulating exactly what PostgREST does — `set local role
-- authenticated` plus the JWT claims — in a rolled-back transaction:
--
--     court at "AIR/Rally HQ" (zero operating hours)
--     INSERT SUCCEEDED — booking created at 3am
--
-- Any signed-in user could do that with a direct API call. It contradicts this
-- project's own rule that RLS is the security boundary and the client is never
-- the security boundary — here the boundary was the server service layer, which
-- is better than the client and still not the database.
--
-- THE ASYMMETRY THAT SHOWED IT. Double-booking is already guarded by an
-- exclusion constraint in the database — createBooking even catches that
-- violation as the expected way a race resolves. So the INTEGRITY guarantee was
-- already in the right layer; the AVAILABILITY guarantee was not. Somebody drew
-- that line correctly once and operating hours ended up on the wrong side.
--
-- WHY THIS IS SAFE TO ADD. Exactly one place in the application inserts a
-- booking — createBooking() in src/lib/services/bookings.ts — and reschedule
-- routes through it rather than inserting its own row. No database function
-- inserts bookings at all. So every legitimate path already passes
-- is_court_time_bookable(), which already enforces everything below. The only
-- inserts this newly rejects are the ones that skipped the service layer.
--
-- WHAT IT DELIBERATELY DOES NOT ENFORCE, and why:
--
--   * MINIMUM LEAD TIME and BOOKING WINDOW — is_court_time_bookable() checks
--     both, but they are customer-facing booking policy rather than facts about
--     the court. A future admin backfill or a support correction may legitimately
--     sit inside the lead time, and a trigger refusing it would be wrong.
--   * OVERLAPPING BOOKINGS — already an exclusion constraint. Re-checking here
--     would duplicate it and race with it.
--   * COURT / VENUE ACTIVE — a different axis, already refused by
--     createBooking(), and folding it in widens the blast radius for no gain
--     against the hole actually found.
--
-- Only INSERT. UPDATE is already covered: prevent_booking_tampering() REVERTS
-- any change to start_time or end_time rather than raising, so an existing
-- booking cannot be moved outside opening hours after the fact.
-- ============================================================================

create or replace function public.enforce_booking_within_open_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day_of_week smallint;
begin
  select v.timezone into v_timezone
  from public.courts c
  join public.venues v on v.id = c.venue_id
  where c.id = new.court_id;

  if v_timezone is null then
    raise exception 'That court does not exist.' using errcode = 'foreign_key_violation';
  end if;

  v_local_start := new.start_time at time zone v_timezone;
  v_local_end := new.end_time at time zone v_timezone;

  -- Same reasoning as is_court_time_bookable(): an operating-hours window is a
  -- time-of-day range on one local day, so a booking spanning midnight cannot
  -- sit inside one and must be refused before the window comparison.
  if v_local_start::date <> v_local_end::date then
    raise exception 'A booking cannot span two days in the venue''s local time.'
      using errcode = 'check_violation';
  end if;

  v_day_of_week := extract(dow from v_local_start::date)::smallint;

  if not exists (
    select 1
    from public.venue_operating_hours voh
    join public.courts c on c.id = new.court_id
    where voh.venue_id = c.venue_id
      and voh.day_of_week = v_day_of_week
      and v_local_start::time >= voh.start_time
      and v_local_end::time <= voh.end_time
  ) then
    -- A venue with NO hours for that day lands here too, which is the case that
    -- prompted this: an owner who has listed courts but not opened any hours
    -- reasonably believes they are not live, and until now the database
    -- disagreed.
    raise exception 'That court is not open at that time.'
      using errcode = 'check_violation',
            hint = 'The venue has no operating hours covering this period.';
  end if;

  if exists (
    select 1 from public.court_blocked_periods bp
    where bp.court_id = new.court_id
      and tstzrange(bp.start_time, bp.end_time, '[)') && tstzrange(new.start_time, new.end_time, '[)')
  ) then
    raise exception 'That court is blocked during that period.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_open_hours on public.bookings;
create trigger bookings_enforce_open_hours
  before insert on public.bookings
  for each row execute function public.enforce_booking_within_open_hours();
