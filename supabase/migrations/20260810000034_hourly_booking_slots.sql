-- Booking slots move from a 30-minute grid to whole hours.
--
-- The app already passes p_increment_minutes explicitly from
-- SLOT_INCREMENT_MINUTES (lib/services/availability.ts), so this changes
-- no current behaviour — it realigns the SQL default so the database and
-- lib/booking-config.ts can't silently disagree if a future caller relies
-- on it.
--
-- p_min_lead_minutes deliberately stays at 30: lead time is how soon
-- before a start a booking may be made, which is unrelated to slot length.
--
-- The body below is unchanged from 20260810000005_availability_functions.sql;
-- only the p_increment_minutes default differs (30 -> 60).

create or replace function public.get_available_slots(
  p_court_id uuid,
  p_local_date date,
  p_duration_minutes integer default 60,
  p_increment_minutes integer default 60,
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
