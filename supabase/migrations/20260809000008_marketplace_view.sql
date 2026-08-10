-- Phase 3: real marketplace queries (search, filter, sort). Additive only
-- — no existing table, column, or RLS policy is altered or dropped.

-- Trigram indexes make `ilike '%term%'` search (see lib/services/venues.ts)
-- fast instead of forcing a sequential scan as the venues table grows.
-- Added here rather than assumed, per the brief's "identify and add
-- appropriate indexes, don't add them blindly" — these back the exact
-- ilike search this phase implements, nothing speculative.
create extension if not exists pg_trgm;

create index venues_name_trgm_idx on public.venues using gin (name gin_trgm_ops);
create index venues_city_trgm_idx on public.venues using gin (city gin_trgm_ops);
create index courts_name_trgm_idx on public.courts using gin (name gin_trgm_ops);

-- Public marketplace read model. One view instead of scattering
-- "status = 'active'" + "no owner_id in the select list" + "starting
-- price = cheapest active court" across every call site in the services
-- layer.
--
-- Security posture (defense in depth, not relying on any single layer):
-- - `security_invoker = true` (Postgres 15+): the view re-checks RLS on
--   `venues`/`courts` for the querying role, same as querying those
--   tables directly would.
-- - The `where v.status = 'active'` below is *also* explicit and
--   redundant with that RLS check, so this view's own definition is
--   unambiguously "public active listings" even if someone were to
--   change the underlying RLS policy later without revisiting this file.
-- - `owner_id` is deliberately not selected — the public marketplace UI
--   has no use for it, so it isn't exposed, full stop.
create view public.venue_marketplace
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
  count(c.id) filter (where c.status = 'active') as active_court_count
from public.venues v
left join public.courts c on c.venue_id = v.id
where v.status = 'active'
group by v.id;

grant select on public.venue_marketplace to anon, authenticated;
