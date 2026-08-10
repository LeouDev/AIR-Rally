-- Phase 4B: the venue_marketplace view (migration 008) predates Phase 4A's
-- venues.timezone column, so the public marketplace read model doesn't
-- expose it yet — the booking UI needs it to interpret/display slots
-- correctly. Additive only.
--
-- CREATE OR REPLACE VIEW requires the existing column list to stay
-- exactly as it was (same names, same order) — new columns can only be
-- appended at the end, not inserted among the existing ones. This
-- reproduces migration 008's definition verbatim and appends `timezone`
-- as the new final column.
--
-- RLS impact: none. Views inherit their access posture from
-- `security_invoker = true` (unchanged) plus the view's own
-- `where v.status = 'active'` (unchanged) — selecting one more column
-- changes what a permitted row returns, not who may read a row.
-- `timezone` is no more sensitive than `city`/`indoor_outdoor`, already
-- public on this same view.
create or replace view public.venue_marketplace
with (security_invoker = true)
as
select
  v.id,
  v.name,
  v.description,
  v.address,
  v.city,
  v.state_province,
  v.country,
  v.latitude,
  v.longitude,
  v.phone,
  v.email,
  v.website,
  v.indoor_outdoor,
  v.number_of_courts,
  v.average_rating,
  v.review_count,
  v.created_at,
  min(c.hourly_price) filter (where c.status = 'active') as starting_price,
  count(c.id) filter (where c.status = 'active') as active_court_count,
  v.timezone
from public.venues v
left join public.courts c on c.venue_id = v.id
where v.status = 'active'
group by v.id;

grant select on public.venue_marketplace to anon, authenticated;
