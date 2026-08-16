-- Adds a venue cover-image path to venue_marketplace, so Explore/Favorites/
-- Featured Courts cards can render a real photo instead of always falling
-- back to the illustrated placeholder.
--
-- CREATE OR REPLACE VIEW requires the existing column list to stay exactly
-- as it was (same names, same order) — new columns can only be appended at
-- the end, not inserted among the existing ones. Reproduces the column list
-- from 20260810000006_venue_marketplace_timezone.sql verbatim and appends
-- cover_image_path as the new final column.
--
-- The cover photo is a scalar correlated subquery against court_images
-- (venue-level images only, court_id is null), not a join, so it stays
-- functionally dependent on v.id (the GROUP BY key) and needs no
-- aggregate wrapping. court_images' own SELECT RLS policy already allows
-- public/anon read for images belonging to an active venue — the same
-- condition this view already filters on — so this is safe for anon
-- callers under security_invoker = true.
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
  v.timezone,
  (
    select ci.storage_path
    from public.court_images ci
    where ci.venue_id = v.id and ci.court_id is null
    order by ci.sort_order asc, ci.created_at asc
    limit 1
  ) as cover_image_path
from public.venues v
left join public.courts c on c.venue_id = v.id
where v.status = 'active'
group by v.id;

grant select on public.venue_marketplace to anon, authenticated;
