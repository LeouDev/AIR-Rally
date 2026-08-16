-- Phase P1.1: the owner-facing per-court day schedule. Additive only.
--
-- WHY A NEW FUNCTION RATHER THAN REUSING get_available_slots() DIRECTLY:
-- get_available_slots() intentionally returns ONLY the slots that are
-- currently bookable — everything else (booked, blocked, outside
-- operating hours) is simply absent from its result, which is exactly
-- right for a customer's booking picker but wrong for an owner's
-- calendar, which needs to show and label EVERY candidate slot,
-- including why it's unavailable.
--
-- This function does NOT reinvent the availability business rule — the
-- windows/candidate-generation CTE below is structurally identical to
-- get_available_slots()'s own (same operating-hours join, same
-- generate_series step, same `AT TIME ZONE` conversion), and the
-- booked/blocked classification uses the exact same tstzrange overlap
-- semantics against the exact same bookings/court_blocked_periods
-- tables. The only difference is presentation: every candidate slot is
-- returned and labeled, instead of only the available ones being kept.
-- This guarantees the owner's calendar and the customer's availability
-- can never disagree about what counts as available — both are
-- evaluated by identical overlap logic against identical live data.
--
-- SECURITY DEFINER, but — unlike get_available_slots()/is_court_time_
-- bookable(), which are anon-callable by design — this function checks
-- ownership itself (owner_id = auth.uid() or is_admin()) and returns no
-- rows at all otherwise, same "unknown/unauthorized looks like empty,
-- not an error" posture as getVenueForOwner()'s own RLS-backed 404.
-- Needed specifically because bookings/court_blocked_periods carry
-- customer/reason details an owner should see for their OWN courts only
-- — a non-owner caller must get nothing, not a differently-shaped error.
create or replace function public.get_owner_court_schedule(
  p_court_id uuid,
  p_local_date date,
  p_duration_minutes integer default 60,
  p_increment_minutes integer default 60
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  status text,
  booking_id uuid,
  booking_status text,
  customer_name text,
  block_id uuid,
  block_reason text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_timezone text;
  v_venue_id uuid;
  v_owner_id uuid;
  v_day_of_week smallint;
begin
  select v.timezone, v.id, v.owner_id
    into v_timezone, v_venue_id, v_owner_id
  from public.courts c
  join public.venues v on v.id = c.venue_id
  where c.id = p_court_id;

  if v_timezone is null or (v_owner_id <> auth.uid() and not public.is_admin()) then
    return;
  end if;

  v_day_of_week := extract(dow from p_local_date)::smallint;

  return query
  with windows as (
    select start_time, end_time
    from public.venue_operating_hours voh
    where voh.venue_id = v_venue_id and voh.day_of_week = v_day_of_week
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
  select
    c.slot_start,
    c.slot_end,
    case
      when b.id is not null then 'booked'
      when bp.id is not null then 'blocked'
      else 'available'
    end as status,
    b.id as booking_id,
    b.status as booking_status,
    pp.display_name as customer_name,
    bp.id as block_id,
    bp.reason as block_reason
  from candidates c
  left join public.bookings b
    on b.court_id = p_court_id
    and b.status in ('pending', 'confirmed')
    and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
  left join public.public_profiles pp on pp.id = b.user_id
  left join public.court_blocked_periods bp
    on bp.court_id = p_court_id
    and b.id is null
    and tstzrange(bp.start_time, bp.end_time, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
  order by c.slot_start;
end;
$$;

revoke all on function public.get_owner_court_schedule(uuid, date, integer, integer) from public, anon;
grant execute on function public.get_owner_court_schedule(uuid, date, integer, integer) to authenticated;

-- RLS impact: none — no existing policy touched. The function's own
-- ownership check is the guard for what it returns; the underlying
-- bookings/court_blocked_periods/venue_operating_hours reads happen
-- inside a SECURITY DEFINER context but are pre-filtered by that check,
-- so this cannot be used to read another owner's data.
--
-- Idempotency impact: none — this is a pure read, no state is written.
