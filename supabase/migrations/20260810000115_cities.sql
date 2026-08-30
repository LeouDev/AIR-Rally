-- Open Match needs to target players "in the same city" (see
-- open-match-design memory), and the city has to be a value both a
-- picker and a reverse-geocode can land on the SAME row for.
--
-- Free text already failed once: a venue-request arrived with its city
-- field literally the word `city`, and even well-intentioned input yields
-- "Cebu", "cebu city", "CEBU" and "cebu" as four distinct strings that
-- silently fail to match each other. A canonical lookup table closes that
-- off at the schema level — the column can only ever hold a slug that
-- exists in `cities`, and every producer (picker, geocode, future admin
-- tool) maps INTO one of these rows rather than writing free text.
--
-- Founder-approved curated list, not every Philippine municipality: the
-- 17 NCR cities/municipalities plus the other places the founder named
-- (Cebu City, Mandaue, Lapu-Lapu, Davao, Iloilo, Cagayan de Oro, Iligan,
-- Baguio). All 3 of today's venue cities (Mandaue, Iligan, Taguig) are
-- in it. `aliases` exists for the reverse-geocode mapping step: Nominatim
-- (already wired in for venues, see explore-sort-design memory) can
-- return "Quezon City", "Lungsod Quezon", or a barangay-level string, and
-- the mapping code needs somewhere to record known variants without
-- retraining on every user's phone. A geocode result that matches
-- nothing here must ask the user, never insert itself as a new row or
-- get stored as raw text elsewhere.
begin;

create table public.cities (
  slug text primary key,
  display_name text not null,
  region text not null,
  aliases text[] not null default '{}',
  sort_order smallint not null
);

comment on table public.cities is
  'Canonical, founder-curated list of cities Open Match can target. '
  'Free text is never stored anywhere that means this — profiles.city_slug '
  'and open_matches.target_city both reference this table so "Cebu", '
  '"cebu city" and "CEBU" cannot become three different places.';

comment on column public.cities.aliases is
  'Known reverse-geocode / free-text variants that should map to this row '
  '(e.g. "Lungsod Quezon" -> quezon-city). Matching logic lives in app '
  'code, not a DB function, since it is a one-time lookup at city-entry '
  'time, not something RLS or another migration needs to call.';

alter table public.cities enable row level security;

create policy "Anyone can view the city list"
on public.cities for select
to anon, authenticated
using (true);

-- No insert/update/delete policy for any client role: the list is
-- founder-curated and changes via migration, the same way ranked seasons
-- do, not via the app.

-- Slugs are deliberately de-accented ('Las Piñas' -> 'las-pinas',
-- 'Parañaque' -> 'paranaque'): a slug is a key a geocoder or a URL has
-- to reproduce byte-for-byte, and accented/unaccented forms look
-- identical to a human but are two different keys to a query. Do not
-- "restore" the ñ into a slug — display_name already carries it.
insert into public.cities (slug, display_name, region, sort_order) values
  ('caloocan',       'Caloocan',       'NCR', 1),
  ('las-pinas',      'Las Piñas',      'NCR', 2),
  ('makati',         'Makati',         'NCR', 3),
  ('malabon',        'Malabon',        'NCR', 4),
  ('mandaluyong',    'Mandaluyong',    'NCR', 5),
  ('manila',         'Manila',         'NCR', 6),
  ('marikina',       'Marikina',       'NCR', 7),
  ('muntinlupa',     'Muntinlupa',     'NCR', 8),
  ('navotas',        'Navotas',        'NCR', 9),
  ('paranaque',      'Parañaque',      'NCR', 10),
  ('pasay',          'Pasay',          'NCR', 11),
  ('pasig',          'Pasig',          'NCR', 12),
  ('pateros',        'Pateros',        'NCR', 13),
  ('quezon-city',    'Quezon City',    'NCR', 14),
  ('san-juan',       'San Juan',       'NCR', 15),
  ('taguig',         'Taguig',         'NCR', 16),
  ('valenzuela',     'Valenzuela',     'NCR', 17),
  ('cebu-city',      'Cebu City',      'Central Visayas', 18),
  ('mandaue',        'Mandaue',        'Central Visayas', 19),
  ('lapu-lapu',      'Lapu-Lapu',      'Central Visayas', 20),
  ('davao',          'Davao',          'Davao Region', 21),
  ('iloilo',         'Iloilo',         'Western Visayas', 22),
  ('cagayan-de-oro', 'Cagayan de Oro', 'Northern Mindanao', 23),
  ('iligan',         'Iligan',         'Northern Mindanao', 24),
  ('baguio',         'Baguio',         'Cordillera Administrative Region', 25);

-- `profiles.city` doesn't exist yet (confirmed absent, not just
-- unpopulated, per the design memory's precondition check) — this is a
-- genuinely new column, not a backfill.
alter table public.profiles
  add column city_slug text references public.cities (slug);

comment on column public.profiles.city_slug is
  'Where this player PLAYS, not where a GPS reading places them right '
  'now — set once inside the Find Match flow (or confirmed from a '
  'reverse-geocode suggestion), never silently overwritten by location. '
  'Nullable: most accounts will not have played ranked yet.';

commit;
