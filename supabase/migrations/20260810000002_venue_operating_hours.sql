-- Phase 4A: venue operating hours. Additive only.
--
-- One row per open window. Multiple rows for the same (venue_id,
-- day_of_week) represent multiple windows in a day (e.g. 08:00-12:00 and
-- 14:00-22:00) — a venue closed all day simply has zero rows for that
-- day_of_week, rather than needing an explicit "closed" flag.
--
-- day_of_week matches Postgres's own `extract(dow from date)` convention
-- (0 = Sunday .. 6 = Saturday) specifically so the availability function
-- (see 20260810000005) can join on it directly without a translation
-- table.
--
-- start_time/end_time are plain `time` — local wall-clock time in the
-- parent venue's `timezone`, not a timestamptz. They only become an actual
-- instant once combined with a specific calendar date and interpreted via
-- `AT TIME ZONE` (see the availability function), which is what makes DST
-- transitions correct for free instead of needing hand-rolled offset math.
--
-- Overnight windows (e.g. 22:00-02:00, where end_time < start_time) are
-- deliberately NOT supported in Phase 4A — the CHECK constraint below
-- rejects them outright rather than silently mishandling them. This is a
-- documented scope decision (see ARCHITECTURE.md), not an oversight.
create table public.venue_operating_hours (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  -- Not a hard business requirement (two identical/overlapping windows on
  -- the same day are wasteful but harmless — get_available_slots would
  -- just compute their union), but it gives seed data and any future
  -- owner-management UI a natural conflict target for idempotent upserts,
  -- and rejects the one truly meaningless case (the exact same window
  -- twice) for free.
  unique (venue_id, day_of_week, start_time)
);

create index venue_operating_hours_venue_day_idx
  on public.venue_operating_hours (venue_id, day_of_week);

create trigger venue_operating_hours_set_updated_at
before update on public.venue_operating_hours
for each row execute function public.set_updated_at();

alter table public.venue_operating_hours enable row level security;

-- Same visibility rule as venues/courts/amenities: public for active
-- venues, always visible to the owner regardless of status, always to
-- admins.
create policy "Public can view operating hours for active venues"
on public.venue_operating_hours for select
using (
  exists (
    select 1 from public.venues v
    where v.id = venue_operating_hours.venue_id
      and (v.status = 'active' or v.owner_id = auth.uid())
  )
  or public.is_admin()
);

create policy "Venue owners manage their own venue's operating hours"
on public.venue_operating_hours for insert
with check (
  exists (select 1 from public.venues v where v.id = venue_operating_hours.venue_id and v.owner_id = auth.uid())
);

create policy "Venue owners update their own venue's operating hours"
on public.venue_operating_hours for update
using (
  exists (select 1 from public.venues v where v.id = venue_operating_hours.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
)
with check (
  exists (select 1 from public.venues v where v.id = venue_operating_hours.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);

create policy "Venue owners remove their own venue's operating hours"
on public.venue_operating_hours for delete
using (
  exists (select 1 from public.venues v where v.id = venue_operating_hours.venue_id and v.owner_id = auth.uid())
  or public.is_admin()
);
