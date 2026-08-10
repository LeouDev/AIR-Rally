-- Phase 4A: availability, computed in Postgres rather than "fetch every
-- booking and filter in JavaScript" — this queries only the relevant
-- court/date window and lets the database do the interval math it's
-- already good at (the exact same `tstzrange`/`&&` semantics the
-- bookings_no_overlap exclusion constraint uses, so a slot this function
-- reports as available is provably insertable, not just probably).
--
-- Both functions are SECURITY DEFINER for the same reason
-- public.is_admin() already is (see
-- supabase/migrations/20260809000001_profiles.sql): an anonymous browsing
-- player needs correct availability without being able to `select *` from
-- bookings or court_blocked_periods directly — those stay
-- privacy-protected under their normal RLS. This is an established
-- pattern in this codebase, not a new one.

-- Returns bookable (slot_start, slot_end) pairs for one court on one
-- local calendar date, at a given duration. Candidates are generated at
-- p_increment_minutes steps within each operating-hours window for that
-- day, converted to UTC via `AT TIME ZONE` (correct across DST, unlike
-- hand-rolled offset math), then filtered against blocked periods,
-- existing active bookings, and the minimum lead time (which subsumes
-- "not in the past" — a lead time > 0 guarantees the result is already in
-- the future).
create or replace function public.get_available_slots(
  p_court_id uuid,
  p_local_date date,
  p_duration_minutes integer default 60,
  p_increment_minutes integer default 30,
  p_min_lead_minutes integer default 30
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_timezone text;
  v_court_status text;
  v_venue_status text;
  v_day_of_week smallint;
begin
  select v.timezone, c.status, v.status
    into v_timezone, v_court_status, v_venue_status
  from public.courts c
  join public.venues v on v.id = c.venue_id
  where c.id = p_court_id;

  -- Unknown court, inactive court, or inactive venue: no slots, not an
  -- error — same "looks like nothing's there" posture as the rest of the
  -- public marketplace read paths.
  if v_timezone is null or v_court_status <> 'active' or v_venue_status <> 'active' then
    return;
  end if;

  v_day_of_week := extract(dow from p_local_date)::smallint;

  return query
  with windows as (
    select start_time, end_time
    from public.venue_operating_hours voh
    join public.courts c on c.id = p_court_id
    where voh.venue_id = c.venue_id and voh.day_of_week = v_day_of_week
  ),
  candidates as (
    select
      (gs.candidate_local at time zone v_timezone) as slot_start,
      ((gs.candidate_local + (p_duration_minutes || ' minutes')::interval) at time zone v_timezone) as slot_end
    from windows w
    cross join lateral generate_series(
      p_local_date + w.start_time,
      p_local_date + w.end_time - (p_duration_minutes || ' minutes')::interval,
      (p_increment_minutes || ' minutes')::interval
    ) as gs(candidate_local)
  )
  select c.slot_start, c.slot_end
  from candidates c
  where c.slot_start >= now() + (p_min_lead_minutes || ' minutes')::interval
    and not exists (
      select 1 from public.court_blocked_periods bp
      where bp.court_id = p_court_id
        and tstzrange(bp.start_time, bp.end_time, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
    and not exists (
      select 1 from public.bookings b
      where b.court_id = p_court_id
        and b.status in ('pending', 'confirmed')
        and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
  order by c.slot_start;
end;
$$;

grant execute on function public.get_available_slots(uuid, date, integer, integer, integer) to anon, authenticated;

-- Narrower check for one specific, already-chosen interval — this is what
-- createBooking() (lib/services/bookings.ts) calls before attempting the
-- insert, purely as a UX nicety to return a specific reason ("outside
-- operating hours" vs a generic error). It is NOT the actual integrity
-- guarantee — the insert itself, protected by the bookings_no_overlap
-- exclusion constraint, is. Never assume this function returning true
-- means the subsequent insert will succeed (a concurrent booking could
-- land in between).
--
-- Duration/increment shape (is this a valid 30-minute-aligned booking at
-- all) is validated in the TypeScript service layer, not here — this
-- function assumes it's already been given a syntactically sane interval
-- and focuses on availability-specific rules: operating hours, blocks,
-- overlap, lead time, and the booking window.
--
-- A request spanning a local midnight boundary is rejected (the interval
-- must fall on a single local calendar date) — consistent with
-- venue_operating_hours not supporting overnight windows.
create or replace function public.is_court_time_bookable(
  p_court_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_min_lead_minutes integer default 30,
  p_max_window_days integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_timezone text;
  v_court_status text;
  v_venue_status text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day_of_week smallint;
  v_window_exists boolean;
begin
  if p_start >= p_end then
    return false;
  end if;

  select v.timezone, c.status, v.status
    into v_timezone, v_court_status, v_venue_status
  from public.courts c
  join public.venues v on v.id = c.venue_id
  where c.id = p_court_id;

  if v_timezone is null or v_court_status <> 'active' or v_venue_status <> 'active' then
    return false;
  end if;

  if p_start < now() + (p_min_lead_minutes || ' minutes')::interval then
    return false;
  end if;

  if p_start > now() + (p_max_window_days || ' days')::interval then
    return false;
  end if;

  v_local_start := p_start at time zone v_timezone;
  v_local_end := p_end at time zone v_timezone;

  -- Must not cross a local calendar day boundary (see the doc comment
  -- above — overnight windows aren't supported in Phase 4A).
  if v_local_start::date <> v_local_end::date then
    return false;
  end if;

  v_day_of_week := extract(dow from v_local_start::date)::smallint;

  select exists (
    select 1 from public.venue_operating_hours voh
    join public.courts c on c.id = p_court_id
    where voh.venue_id = c.venue_id
      and voh.day_of_week = v_day_of_week
      and v_local_start::time >= voh.start_time
      and v_local_end::time <= voh.end_time
  ) into v_window_exists;

  if not v_window_exists then
    return false;
  end if;

  if exists (
    select 1 from public.court_blocked_periods bp
    where bp.court_id = p_court_id
      and tstzrange(bp.start_time, bp.end_time, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.court_id = p_court_id
      and b.status in ('pending', 'confirmed')
      and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.is_court_time_bookable(uuid, timestamptz, timestamptz, integer, integer) to anon, authenticated;
