-- Phase 4A: per-court blocked periods (maintenance, private events, venue
-- closures affecting a specific court). Additive only.
--
-- Court-scoped, not venue-scoped: a venue-wide closure is represented as
-- one block row per court at that venue rather than a second, parallel
-- venue-level block table — there's no current product requirement that
-- justifies the extra surface, and the availability function already
-- queries per-court.
--
-- start_time/end_time are timestamptz (unlike operating_hours' plain
-- `time`) because a block is a specific real-world event on a specific
-- date, not a repeating weekly pattern.
--
-- RLS deliberately has NO public select policy — unlike venues/courts/
-- amenities, a block's `reason` could plausibly contain something an
-- owner wouldn't want a random visitor reading (e.g. a private event's
-- client name). Public availability is computed through the
-- SECURITY DEFINER get_available_slots()/is_court_time_bookable()
-- functions (see 20260810000005), which read this table's start/end
-- internally without ever exposing `reason` or `created_by` to the
-- caller — the same defense-in-depth shape as public_profiles hiding
-- phone/email/role from the base profiles table.
create table public.court_blocked_periods (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index court_blocked_periods_court_start_idx
  on public.court_blocked_periods (court_id, start_time);

create trigger court_blocked_periods_set_updated_at
before update on public.court_blocked_periods
for each row execute function public.set_updated_at();

alter table public.court_blocked_periods enable row level security;

create policy "Venue owners view blocks for their own courts"
on public.court_blocked_periods for select
using (
  exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = court_blocked_periods.court_id and v.owner_id = auth.uid()
  )
  or public.is_admin()
);

create policy "Venue owners create blocks for their own courts"
on public.court_blocked_periods for insert
with check (
  exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = court_blocked_periods.court_id and v.owner_id = auth.uid()
  )
);

create policy "Venue owners update blocks for their own courts"
on public.court_blocked_periods for update
using (
  exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = court_blocked_periods.court_id and v.owner_id = auth.uid()
  )
  or public.is_admin()
)
with check (
  exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = court_blocked_periods.court_id and v.owner_id = auth.uid()
  )
  or public.is_admin()
);

create policy "Venue owners remove blocks for their own courts"
on public.court_blocked_periods for delete
using (
  exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = court_blocked_periods.court_id and v.owner_id = auth.uid()
  )
  or public.is_admin()
);
