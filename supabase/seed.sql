-- Air/Rally demo seed data — Phase 3, extended in Phase 4A.
--
-- Purpose: populate a few realistic venues/courts/amenities/reviews so the
-- real marketplace (Explore, landing page, Court Details, Favorites) has
-- something to show, and (Phase 4A) give those same demo venues real
-- operating hours so the availability/booking engine has something to
-- compute against — a court with zero operating_hours rows is never
-- bookable, so this isn't optional if you want to exercise booking
-- locally. This is NOT part of supabase/migrations/ — it's data, not
-- schema, and running it is optional and explicit, never automatic.
--
-- HOW TO RUN (safe on any project that already has migrations applied):
--   1. Apply every file in supabase/migrations/ first, in order (see README.md).
--   2. The designated demo venue-owner account must already exist and be
--      signed up — see DEMO_OWNER_EMAIL below. If that auth account or its
--      profiles row is missing, this script raises a clear notice and
--      inserts nothing (never creates an account on your behalf).
--   3. Open the Supabase SQL Editor and run this file's contents once.
--
-- SAFE / REPEATABLE: every seeded row uses a fixed UUID (not
-- gen_random_uuid()) and every insert uses `on conflict (id) do nothing`,
-- so running this file multiple times is a no-op after the first run — it
-- will never create duplicates or error on a second run.
--
-- IDENTIFIABLE: every seeded venue name is prefixed "[DEMO] " specifically
-- so it's never mistaken for a real listing. To remove all seed data later:
--   delete from public.venues where name like '[DEMO]%';
-- (courts, venue_amenities, court_images, and reviews cascade-delete with it)
--
-- WHAT THIS DOES NOT DO: it does not create a new auth account, and it does
-- not touch any table this project doesn't already own. It requires the
-- specific account below (DEMO_OWNER_EMAIL) to already exist — creating an
-- auth.users row requires Supabase Auth's own signup flow (or the Admin API
-- with a service-role key, which this project deliberately never uses —
-- see ARCHITECTURE.md's RLS strategy), so a plain SQL script can only look
-- up an existing account, never create one.
--
-- DEMO_OWNER_EMAIL: the account every seeded venue is owned by and every
-- seeded review is authored by. Change the literal email string below if a
-- different account should own the demo data — this script does not fall
-- back to "whichever profile exists" if this exact account isn't found; it
-- stops and does nothing instead (see the two `raise notice` branches).

do $$
declare
  seed_owner uuid;
  target_email text := 'galileouuu@gmail.com';
  auth_user_exists boolean;
begin
  -- Looked up by email via auth.users, joined to public.profiles by id —
  -- profiles has no email column of its own (see
  -- supabase/migrations/20260809000001_profiles.sql), every profile row is
  -- keyed 1:1 with an auth.users row via `id`.
  select exists(select 1 from auth.users where email = target_email) into auth_user_exists;

  if not auth_user_exists then
    raise notice 'No auth account exists for %. Nothing was inserted. Sign up that account first, or change target_email in this script.', target_email;
    return;
  end if;

  select p.id into seed_owner
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = target_email;

  if seed_owner is null then
    raise notice 'An auth account exists for % but it has no matching public.profiles row. Nothing was inserted. This should not normally happen (see handle_new_user in the profiles migration) — investigate before proceeding.', target_email;
    return;
  end if;

  -- Venues ------------------------------------------------------------
  insert into public.venues (
    id, owner_id, name, description, address, city, state_province, country,
    phone, email, website, indoor_outdoor, number_of_courts, status
  ) values
    (
      '00000000-0000-4000-8000-000000000001', seed_owner,
      '[DEMO] Banilad Pickle Club',
      'Six championship-grade indoor courts with cushioned acrylic surfacing, right in the heart of Banilad. Air-conditioned, well-lit, and open late.',
      '88 Banilad Road', 'Cebu City', 'Cebu', 'Philippines',
      '+639171234567', 'hello@baniladpickle.example', 'https://baniladpickle.example',
      'indoor', 6, 'active'
    ),
    (
      '00000000-0000-4000-8000-000000000002', seed_owner,
      '[DEMO] Mandaue Rally Courts',
      'Four outdoor courts with night lighting, a short walk from Mandaue''s business district. Casual, affordable, and great for after-work games.',
      '14 J. Luna Avenue', 'Mandaue City', 'Cebu', 'Philippines',
      '+639179876543', 'play@mandauerally.example', null,
      'outdoor', 4, 'active'
    ),
    (
      '00000000-0000-4000-8000-000000000003', seed_owner,
      '[DEMO] BGC Smash Pickleball',
      'Premium indoor facility in Bonifacio Global City with a pro shop, spectator seating, and a café. Popular with competitive players.',
      '7th Avenue', 'Taguig', 'Metro Manila', 'Philippines',
      '+639201112222', 'info@bgcsmash.example', 'https://bgcsmash.example',
      'both', 8, 'active'
    )
  on conflict (id) do nothing;

  -- Operating hours (Phase 4A) --------------------------------------------
  -- Realistic, varied schedules so the availability/booking engine has
  -- something real to compute against. Banilad and Mandaue are open one
  -- window every day; BGC Smash demonstrates the multiple-windows-per-day
  -- case (closed 12:00-13:00 for cleaning). day_of_week 0=Sunday..6=Saturday,
  -- matching Postgres's own extract(dow from ...) — see
  -- supabase/migrations/20260810000002_venue_operating_hours.sql.
  -- Explicit ::uuid casts on every literal below — without them, Postgres
  -- resolves the UUID string literal's type from the UNION ALL as a whole
  -- (all four branches combined) rather than per-branch, which collapses
  -- it to `text`. A `text` value doesn't implicitly cast to a `uuid`
  -- column the way an untyped literal does, so the insert fails with
  -- "column venue_id is of type uuid but expression is of type text" —
  -- caught while first running this block, not assumed to be fine.
  insert into public.venue_operating_hours (venue_id, day_of_week, start_time, end_time)
  select '00000000-0000-4000-8000-000000000001'::uuid, d, time '06:00', time '23:00'
  from generate_series(0, 6) as d
  union all
  select '00000000-0000-4000-8000-000000000002'::uuid, d, time '06:00', time '22:00'
  from generate_series(0, 6) as d
  union all
  select '00000000-0000-4000-8000-000000000003'::uuid, d, time '06:00', time '12:00'
  from generate_series(0, 6) as d
  union all
  select '00000000-0000-4000-8000-000000000003'::uuid, d, time '13:00', time '23:00'
  from generate_series(0, 6) as d
  on conflict (venue_id, day_of_week, start_time) do nothing;

  -- Courts --------------------------------------------------------------
  insert into public.courts (id, venue_id, name, surface_type, indoor_outdoor, capacity, hourly_price, status) values
    ('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8000-000000000001', 'Court 1', 'Cushioned Acrylic', 'indoor', 4, 500, 'active'),
    ('00000000-0000-4000-8001-000000000002', '00000000-0000-4000-8000-000000000001', 'Court 2', 'Cushioned Acrylic', 'indoor', 4, 500, 'active'),
    ('00000000-0000-4000-8001-000000000003', '00000000-0000-4000-8000-000000000001', 'Court 3', 'Cushioned Acrylic', 'indoor', 4, 550, 'active'),
    ('00000000-0000-4000-8002-000000000001', '00000000-0000-4000-8000-000000000002', 'Court A', 'Acrylic', 'outdoor', 4, 300, 'active'),
    ('00000000-0000-4000-8002-000000000002', '00000000-0000-4000-8000-000000000002', 'Court B', 'Acrylic', 'outdoor', 4, 300, 'active'),
    ('00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8000-000000000003', 'Center Court', 'Cushioned Acrylic', 'indoor', 4, 900, 'active'),
    ('00000000-0000-4000-8003-000000000002', '00000000-0000-4000-8000-000000000003', 'Court 2', 'Cushioned Acrylic', 'indoor', 4, 800, 'active'),
    ('00000000-0000-4000-8003-000000000003', '00000000-0000-4000-8000-000000000003', 'Rooftop Court', 'Acrylic', 'outdoor', 4, 700, 'active')
  on conflict (id) do nothing;

  -- Amenities (linking to the fixed set seeded in the amenities migration) --
  insert into public.venue_amenities (venue_id, amenity_id)
  select '00000000-0000-4000-8000-000000000001', id from public.amenities
    where name in ('Air Conditioned', 'Night Lighting', 'Restrooms', 'Water Station', 'Lockers')
  on conflict do nothing;

  insert into public.venue_amenities (venue_id, amenity_id)
  select '00000000-0000-4000-8000-000000000002', id from public.amenities
    where name in ('Night Lighting', 'Free Parking', 'Restrooms')
  on conflict do nothing;

  insert into public.venue_amenities (venue_id, amenity_id)
  select '00000000-0000-4000-8000-000000000003', id from public.amenities
    where name in ('Air Conditioned', 'Pro Shop', 'Spectator Seating', 'On-site Café', 'Wi-Fi', 'Showers')
  on conflict do nothing;

  -- Reviews (author is the same seed_owner profile — see the note above on
  -- why a plain SQL script can't create a distinct demo reviewer account;
  -- venues.average_rating/review_count update automatically via the
  -- existing reviews_update_venue_rating trigger, no manual set needed) --
  insert into public.reviews (id, venue_id, user_id, rating, title, comment) values
    ('00000000-0000-4000-8004-000000000001', '00000000-0000-4000-8000-000000000001', seed_owner, 5, 'Best courts in Cebu', 'Immaculate surfaces and the AC makes a huge difference in the afternoon heat.'),
    ('00000000-0000-4000-8004-000000000002', '00000000-0000-4000-8000-000000000001', seed_owner, 4, 'Great but gets busy', 'Book early on weekends — fills up fast after 5pm.'),
    ('00000000-0000-4000-8004-000000000003', '00000000-0000-4000-8000-000000000002', seed_owner, 4, 'Solid casual spot', 'Good lighting at night and easy parking. Nothing fancy but does the job.'),
    ('00000000-0000-4000-8004-000000000004', '00000000-0000-4000-8000-000000000003', seed_owner, 5, 'Worth the price', 'Center court is genuinely tournament quality. Café is a nice touch after a long session.')
  on conflict (id) do nothing;

  raise notice 'Seed complete: 3 demo venues, 8 courts, amenity links, 4 reviews, and 28 operating-hours windows (owner/author: profile %).', seed_owner;
end $$;

-- No court_images rows are seeded — every venue above intentionally has no
-- photos, so it exercises the real "no images yet" path: ImageGallery's
-- illustrated CourtSurface fallback, not a placeholder photo. This is the
-- honest state for a freshly-listed real venue (no photo upload UI exists
-- yet — see ARCHITECTURE.md).
