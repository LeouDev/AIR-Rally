# Roadmap

## Phase 1 — Project Foundation & Product Shell (this repo)

A production-quality foundation and a polished, functional product shell. No real backend, payments, or complex booking logic — see "Intentionally not implemented" below.

**Built:**

- Design system: color tokens, typography, spacing/radius scale (light + dark) — [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)
- Responsive app shell: sticky desktop nav, mobile bottom tab bar, footer
- Landing page: hero, search widget, featured courts, why Air/Rally, how it works, CTA
- Explore page: filters (court type, price, rating, amenities), results grid, map placeholder, mobile list/map toggle
- Court details page: image gallery, info, description, amenities, availability selector, booking panel, reviews, map placeholder
- Auth UI: sign in, create account, forgot password — validated with Zod, structurally ready for Supabase Auth, no fake session logic
- Favorites: real, persisted (localStorage via Zustand) — the one genuinely functional cross-page feature in Phase 1
- Bookings / Profile: polished signed-out / empty states
- List Your Court: owner-facing marketing page with a single CTA into sign-up
- Mock data layer for courts, reviews, amenities, locations
- Service abstractions for maps, payments, and auth (interfaces only — see [ARCHITECTURE.md](./ARCHITECTURE.md))
- Loading, empty, and error states for every data-driven view
- Basic accessibility pass: semantic HTML, keyboard focus states, ARIA labels on icon-only controls
- Jest + React Testing Library setup with tests for `Rating`, `EmptyState`, and `CourtCard`
- TypeScript strict mode, ESLint, production build all passing

## Intentionally not implemented (Phase 1)

These were explicitly out of scope per the project brief, to avoid a foundation that has to be torn up later:

- Real payments / Stripe integration
- Real-time booking or a booking database
- Supabase database connection (architecture is ready for it — see mock data layer)
- Court owner analytics / dashboard
- Tournament or league system
- Coach marketplace
- AI matchmaking or dynamic pricing
- Loyalty system
- Chat / messaging
- Push notifications
- QR check-in
- Equipment marketplace
- A live map (Google Maps / Mapbox) — `MapPlaceholder` stands in

## Phase 2 — Authentication & Supabase Foundation (this repo)

Turns the Phase 1 shell into a real application foundation: authentication, user profiles, a full database schema, Row Level Security, and the start of venue owner onboarding. No booking engine or payments yet — see "Intentionally not implemented" below.

**Built:**

- Supabase client architecture: separate browser/server clients, `proxy.ts` session refresh (Next 16 renamed `middleware.ts` → `proxy.ts`), safe read-only auth helpers — [ARCHITECTURE.md](./ARCHITECTURE.md#supabase-client-architecture-srclibsupabase)
- Full database schema as numbered SQL migrations: `profiles`, `venues`, `courts`, `amenities`, `venue_amenities`, `court_images`, `favorites`, `reviews` — [ARCHITECTURE.md](./ARCHITECTURE.md#how-to-run-migrations)
- Row Level Security on every table, no "allow everything" policies — [ARCHITECTURE.md](./ARCHITECTURE.md#rls-strategy)
- Role system (`player` / `venue_owner` / `admin`) with self-escalation blocked at the database layer, not just the client — [ARCHITECTURE.md](./ARCHITECTURE.md#role-system-and-authorization)
- Real Supabase Auth: sign up (with email confirmation handling), sign in, sign out, forgot/reset password, session persistence — wired into the existing Phase 1 auth screens without redesigning them
- Protected routes (`/profile`, `/bookings`, `/favorites`) with redirect-back-after-login (`?redirect=`)
- Auth-aware navigation: signed-out (Sign In / Get Started) vs. signed-in (avatar menu with Profile/Bookings/Favorites/Logout)
- Real profile page: view + edit (first/last/display name, phone, avatar URL), backed by Postgres
- Venue owner onboarding: `/list-your-court` now includes a real draft-venue form (saves as `status = 'draft'`) plus a list of the signed-in owner's existing venues
- Services/repository layer (`lib/services/{profiles,favorites,venues,courts,reviews}.ts`) as the seam for eventually swapping Explore/Court Details off mock data — [ARCHITECTURE.md](./ARCHITECTURE.md#mock-data-srclibmock-data-and-the-services-layer-srclibservices)
- Friendly error messages everywhere (`lib/errors.ts`) — raw Postgres/Supabase errors never reach the UI
- Zod validation shared between client forms and server actions (never trusting client validation alone)
- The whole app still runs and builds with **zero environment variables** — every Supabase-touching code path degrades to a signed-out/not-configured state instead of crashing
- 57 Jest tests (up from 7): validation schemas, the favorites/profiles services against a mocked Supabase client, the friendly-error mapper, and the proxy's real redirect behavior via an actual `NextRequest`
- TypeScript strict mode, ESLint, production build all passing

## Intentionally not implemented (Phase 2)

Explicitly out of scope per the project brief:

- Real bookings, availability engine, or booking conflicts
- Payments / Stripe / payouts
- Cancellation policies or dynamic pricing
- Notifications, Open Play, coach marketplace, tournaments, leagues, AI matchmaking
- Owner analytics or a full owner dashboard (only draft venue creation exists)
- Review *submission* through the UI (the `reviews` table and RLS policies exist and are correct, but nothing calls insert yet — reviews are meant to attach to a completed booking, which doesn't exist until the booking engine does)
- Avatar file upload (a URL field exists; Supabase Storage integration doesn't yet)
- Explore/Court Details reading from Supabase instead of mock data (the services layer is ready; the UI swap is deferred)

## Phase 2.5 — Real Supabase Connection & End-to-End Verification (this repo)

Connected the Phase 2 foundation to a real Supabase project (`hrpbjudsrqcgyrkkodop`) and verified it live instead of against mocks. See [ARCHITECTURE.md](./ARCHITECTURE.md#phase-25-real-supabase-connection--end-to-end-verification) for full detail.

**Verified live:** signup (real `auth.users` + trigger-created `profiles` row, `role: player` by default), login, logout, session persistence, protected-route redirects, profile edit + persistence, self role-escalation blocked (live, via a direct `PATCH` attempt), venue status self-escalation blocked (live), IDOR/identity-spoofing attempts on `favorites` and `venues` rejected with `403`, anonymous-vs-owner venue/court visibility, full favorites CRUD + duplicate-prevention, cascading deletes.

**Fixed:** a real logout bug live testing caught — the nav didn't update after logout because the sign-out server action and the browser's `onAuthStateChange` listener were talking to two different Supabase client instances. Also removed a dead Phase 1 file (`lib/services/auth.ts`) that code review caught during this pass.

**Added:** support for Supabase's current-generation `sb_publishable_...` key format (checked first, falling back to the legacy JWT anon key) — `getSupabaseEnv()` now accepts either.

**Known limitations:**
- No live two-distinct-owner cross-account test — blocked by Supabase's free-tier email rate limit after earlier signup/reset testing. The identical `owner_id = auth.uid()` policy expression was already proven live via IDOR/spoofing tests on `INSERT`; this just wasn't independently re-confirmed with a second real session.
- Password reset was verified through the request step (`resetPasswordForEmail` succeeds against the real API); full click-through completion wasn't independently confirmed due to Gmail's link-prescanning consuming the single-use link before manual click — a known Supabase + Gmail interaction, not an app-side issue.
- Supabase CLI-based migrations weren't possible (`supabase login` needs an interactive browser callback this environment's shell can't provide) — migrations were applied via the SQL Editor instead, then independently verified against the live schema via the REST API.

## Suggested Phase 3

In rough priority order:

1. **Booking engine** — a `bookings` table, availability/conflict handling, and a real `/bookings` list. This is also what unblocks review submission (reviews should attach to a completed booking).
2. **Mock data → Supabase swap** — point Explore, the landing page, and Court Details at `lib/services/venues.ts` / `courts.ts` instead of `lib/mock-data`. The services and RLS policies already exist (Phase 2); this is UI rewiring, not new backend work.
3. **Real search** — connect the Explore filters and hero `SearchBar` to actual querying once #2 is done.
4. **Payments** — implement `PaymentProvider` with Stripe behind `BookingPanel`'s existing call to `createCheckout`.
5. **Live map** — implement `MapProvider` (Google Maps or Mapbox) and swap it into `MapPlaceholder`'s call sites.
6. **Supabase Storage** — real avatar and venue/court image upload, replacing the URL-paste field and populating `court_images`.
7. **Owner dashboard** — court/schedule management for `venue_owner` accounts, building on the draft venues created in Phase 2.
8. **Admin tooling** — a real UI for the venue approval flow (`draft`/`pending_review` → `active`) that today requires a direct SQL update.

Phase 3 shouldn't need to restructure the database schema, RLS policies, or auth flow — those were built in Phase 2 to absorb a real booking engine without a rewrite.
