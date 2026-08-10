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

## Phase 3 — Real Court Marketplace (this repo)

Swapped Explore, the landing page, Court Details, and Favorites off mock data onto real Supabase queries, and gave venue owners a real venue/court/amenity management UI. No booking engine, payments, or availability logic yet — see "Intentionally not implemented" below. Full detail in [ARCHITECTURE.md](./ARCHITECTURE.md#phase-3-real-court-marketplace).

**Built:**

- `venue_marketplace` view — the public read model every player-facing query uses; excludes `owner_id`, computes `starting_price`/`active_court_count`, `security_invoker` + an explicit `status = 'active'` filter as defense in depth
- Real search/filter/sort/pagination on Explore, with filter state driven entirely by the URL (`lib/explore-params.ts`, `useExploreFilters()`) so results are shareable/bookmarkable and survive back/forward navigation
- Deterministic "Recommended" ranking (rating desc, review count as tiebreaker) — documented, not a black box
- Amenity filtering with AND semantics (a venue must have every selected amenity), search-term and amenity-id input sanitization against filter-string injection
- Debounced search/price inputs (400–500ms), reset via a remount-on-URL-change pattern rather than a `setState`-in-`useEffect` (the latter is flagged by this project's React Compiler lint as a cascading-render risk)
- Court Details: real venue/courts/amenities/reviews/images, a beautiful 404 for a missing *or* draft venue (indistinguishable to a player, by design), `generateMetadata` per venue, and a fix so a malformed venue id shows the 404 too instead of a generic error page
- Favorites fully real and persisted (add/remove/list via Supabase, RLS-scoped) — Zustand (`useFavoritesStore`) removed entirely, no longer needed
- Reviews: real reads with author name (via `public_profiles`, not a blocked RLS embed) — submission remains deferred until a booking exists to attach a review to
- Real Storage integration for venue/court images (`venue-images` bucket + owner-scoped RLS policies) — architecturally complete but unexercised, since no upload UI exists yet
- Venue owner: edit an existing venue, manage its amenities, and create/edit/activate/deactivate its courts (`/list-your-court/[venueId]`) — all authorization enforced by RLS, not application code, matching the pattern Phase 2 established for venue status
- Mock data audit: `mock-data/{courts,reviews,amenities}.ts` and their matching mock types deleted (confirmed orphaned); `mock-data/locations.ts` kept and redocumented as static UI data (the city dropdown's option list), not marketplace content
- Optional demo seed script (`supabase/seed.sql`) — 3 demo venues, 8 courts, amenities, 4 reviews, idempotent and clearly named `[DEMO] ...`; not run automatically
- A real bug caught by live browser verification (not just automated tests): `CourtsManager` forked its `courts` prop into `useState` once, so the list went stale after every add/edit/toggle until a manual reload — fixed by reading the prop directly
- A dedicated Phase 3 security review (IDOR, owner-id manipulation, RLS bypass, sensitive-data exposure, query-param injection) — no new RLS policy changes were needed; every write path already fit Phase 2's established shape
- 128 Jest tests (up from 57): venue/court/amenity services, search/filter/sanitization logic, URL-state parse/serialize, and authorization-guard behavior for every server action, including two environment-specific fixes (server actions need `@jest-environment node`; `jest.mock()` needs relative paths in this checkout — see [ARCHITECTURE.md](./ARCHITECTURE.md#testing-server-actions-need-jest-environment-node-and-a-second-jestmock-gotcha))
- TypeScript strict mode, ESLint (including fixing two pre-existing `set-state-in-effect` errors caught during this pass), production build all passing

## Intentionally not implemented (Phase 3)

Explicitly out of scope per the project brief — the architecture is prepared for these where it made sense to, but none are implemented:

- Booking engine, availability/time-slot logic, booking conflicts (`lib/services/payments.ts` stays a stub; court hourly pricing is display-only)
- Payments / Stripe / payouts, cancellation policies, dynamic pricing
- Review *submission* (reads are real; writing one is deferred until it can attach to a completed booking)
- Open Play, player matchmaking, coach marketplace, tournaments, leagues, notifications, QR check-in, equipment marketplace, advanced analytics
- Venue/court image *upload* (the Storage bucket, RLS policies, and URL-resolution helper are real and correct; there's no UI to actually upload a file yet)
- Admin tooling for the venue approval flow (`draft`/`pending_review` → `active` still requires a direct SQL update, same as Phase 2)
- A live map (`MapPlaceholder` still stands in)

## Phase 4A — Availability + Booking Engine Foundation (this repo)

The database-level foundation for real bookings, with **no booking UI and no payments** — schema, service layer, and proof that the one non-negotiable requirement holds. Full detail in [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4a-availability--booking-engine-foundation).

**Built:**

- `venues.timezone` (IANA identifier, e.g. `"Asia/Manila"`) — courts inherit it; every existing venue backfilled correctly (all are genuinely Philippines-based)
- `venue_operating_hours` — normalized, venue-level, multiple windows/day supported (not a JSON blob); overnight windows explicitly out of scope
- `court_blocked_periods` — per-court maintenance/closure windows; no public read policy (unlike everything else in this schema) since `reason` could be sensitive — availability is computed through a `SECURITY DEFINER` function instead, never exposing the raw rows
- `bookings` — `pending`/`confirmed`/`cancelled` (not five statuses — `completed`/`expired` need infrastructure that doesn't exist yet, see ARCHITECTURE.md), an integer-minor-units price snapshot taken at creation and never recalculated, a non-sequential confirmation code
- **The actual guarantee**: a partial Postgres exclusion constraint (`btree_gist` + `tstzrange(..., '[)')` + `court_id` equality, scoped to active statuses only) — the database itself rejects a double-booking; proven, not assumed, by a real concurrent-insert script against the live project (see below)
- Two `SECURITY DEFINER` availability functions (`get_available_slots`, `is_court_time_bookable`) computing availability inside Postgres — scoped per-court/per-date, never "fetch every booking and filter in JS"
- `lib/services/bookings.ts`/`availability.ts` + `lib/actions/booking.ts` — full creation/cancellation service and action layer, typed `BookingError` reasons, the same `ActionResult`/`getServerClient` shape as every other action
- RLS matching Phase 2's established shape exactly: ownership-scoped policies plus a `BEFORE UPDATE` trigger (not `WITH CHECK`) blocking tampering with identity/price/time fields and restricting self-service status changes to `pending|confirmed → cancelled` only
- `scripts/verify-no-double-booking.ts` — a manual, deliberately-not-CI script that races two real concurrent bookings against the live database and proves exactly one succeeds; kept separate from the automated suite because there's no local Postgres in this project's dev environment to run a true concurrency test any other way
- 39 new Jest tests (167 total, up from 128) covering every validation branch, the price snapshot, the `23P01` → friendly-message mapping, and every action's auth guard
- `supabase/seed.sql` extended with realistic operating-hours data for the 3 `[DEMO]` venues (needed for the booking engine to have anything to compute against)
- TypeScript strict mode, ESLint, production build all passing

## Intentionally not implemented (Phase 4A)

- Any booking UI — no calendar, no time-slot picker, no checkout, no confirmation page, no "My Bookings" view
- Payments, Stripe, payouts, refunds
- Notifications, email/SMS confirmations
- `completed`/`expired` booking statuses (need a scheduled job and a checkout flow respectively — neither exists yet)
- Owner-initiated cancellation (a policy question that belongs with payments/refunds)
- A "manage bookings" view for venue owners (RLS already grants the read access; nothing queries it yet)
- Overnight operating-hours windows, bookings spanning a local midnight boundary

## Phase 4B — Booking UX + Payments (this repo)

The real customer booking flow, on top of Phase 4A's database foundation: Explore → Court Details → pick a date/time → booking summary → Stripe Checkout → payment → a webhook-confirmed booking → confirmation page → My Bookings, plus cancellation. Full detail in [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments).

> **Status note:** both Phase 4B migrations are applied to the live Supabase project and independently verified via read-only queries, and live Stripe TEST MODE verification has run and passed end-to-end (real Checkout Session, real test-card payment, a real signature-verified webhook delivery that correctly confirmed the booking, and a proven idempotent duplicate delivery). See [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments) for exactly what was tested.

**Built:**

- Real Stripe Checkout integration (`lib/services/payments.ts`) — hosted, redirect-only Checkout Sessions; no client-side Stripe.js, no publishable key, since the browser's only job is following `session.url`
- **Booking-before-Stripe ordering**: `createCheckoutSessionAction` creates a real `pending` booking first — so the Phase 4A exclusion constraint gets to reject an unavailable slot before Stripe is ever contacted — and cancels that pending booking automatically if Checkout Session creation fails afterward
- A Stripe webhook endpoint (`src/app/api/stripe/webhook/route.ts`) as the **sole authority** for "was this booking paid for" — the browser's redirect back from Stripe is never trusted as proof of payment; raw-body signature verification, `checkout.session.completed` as the one event acted on, idempotent by construction (a duplicate delivery safely no-ops rather than needing a separate processed-events table)
- `confirm_booking_payment()` — a `SECURITY DEFINER` Postgres RPC (same established pattern as `is_admin()`/`get_available_slots()`) used for webhook reconciliation instead of a Supabase service-role key, which — consistent with every earlier phase — never enters this app's runtime at all
- `reconcilePendingBooking()` — the "browser redirect arrives before the webhook" fallback on the confirmation page, checking Stripe's own API directly and confirming through the exact same guarded RPC the webhook itself uses
- `BookingWidget` (replacing `CourtsPricingPanel` on Court Details) — real date/duration/time-slot selection calling the unchanged Phase 4A `get_available_slots` RPC, a booking summary, and real Stripe redirect on "Book Now"
- A real confirmation page and a real "My Bookings" page (replacing both prior stub/empty states) — status badges, confirmation codes, price display, and a real `CancelBookingButton` wired to the unchanged Phase 4A `cancelBookingAction`
- Price integrity end-to-end: every Stripe charge traces to the pending booking's own server-computed price snapshot; the webhook independently re-checks Stripe's reported amount/currency against that same stored value before confirming anything
- 46 new Jest tests (213 total, up from 167) covering the payments service, the checkout/availability actions, the extended booking-service functions, and the webhook route handler — including the booking-before-Stripe call-ordering assertion and the duplicate-webhook idempotency proof
- `scripts/verify-stripe-webhook-flow.ts` — a manual, deliberately-not-CI script (same posture as `verify-no-double-booking.ts`) that creates a real pending booking and Checkout Session, then — after a real test-card payment — signs a real Stripe event with `generateTestHeaderString` and POSTs it to the real webhook route, proving both correct confirmation and idempotency against the live database; run and passed
- TypeScript strict mode, ESLint, production build all passing

## Intentionally not implemented (Phase 4B)

Explicitly out of scope per the project brief:

- Venue-owner booking dashboard, payouts, Stripe Connect
- Subscriptions, memberships, promo/gift codes, recurring bookings
- Automatic refunds on cancellation — the existing cancellation flow is unchanged and refunds nothing automatically; the cancellation dialog says so explicitly rather than implying one happens
- `completed`/`expired` booking-status automation — still just `pending`/`confirmed`/`cancelled`, same reasoning as Phase 4A
- Abandoned-pending-booking expiry — a pending booking a user never completes or cancels stays pending (and holds its slot) indefinitely; no scheduled-task infrastructure exists yet to expire it (see ARCHITECTURE.md's "Known limitation" section)
- Tournaments, player matching, chat, notifications beyond the booking confirmation page itself, reviews redesign, loyalty/rewards

## Phase 5 (in progress) — Review submission (this repo)

The first item on the "Suggested Phase 5" list below, now built: a signed-in user can write a review for a venue once they have a real `confirmed` booking there whose `end_time` has passed — `confirmed` is already the payment-verified state Phase 4B's webhook sets, so there's no separate "was it paid" check to invent. Fully independent of the paused Phase 4B.5 payment-provider decision — only reads `bookings.status`/`end_time`, never touches price or Stripe fields.

**Built:**
- `lib/services/reviews.ts#getReviewEligibility()` — two separate queries (a venue's courts, then the caller's own confirmed-and-past bookings at those courts), not a `courts!inner(...)` embed, for the same "an embed applies the joined table's own RLS and can silently drop a valid case" reason `createBooking()` already documents for its own courts/venues lookup
- `lib/services/reviews.ts#createReview()` — re-verifies eligibility server-side rather than trusting a client-supplied booking id, then a plain RLS-scoped insert; `venues.average_rating`/`review_count` update automatically via the existing Phase 2 `update_venue_rating_stats()` trigger, no new aggregation code
- `lib/actions/review.ts#submitReviewAction` / `lib/validations/review.ts` — same `ActionResult`/Zod-shape-then-service-business-rules split as every other action in this codebase
- A review-submission form on Court Details (interactive star picker, optional title/comment), rendered only when the server page has already determined the signed-in user is eligible — an ineligible visitor sees no control at all, not a disabled one
- No new migration required — the `reviews` table, its RLS policies, and the rating-aggregate trigger all already existed from Phase 2, unused until now
- 11 new Jest tests (224 total, up from 213)
- TypeScript strict mode, ESLint, production build all passing; live browser check confirmed the eligibility gate correctly hides the form for an ineligible signed-in user with no console errors

## Suggested Phase 5 (remaining)

In rough priority order:

1. ~~Review submission~~ — done, see above.
2. **Venue/court image upload** — a real upload UI writing into the `venue-images` bucket that already exists; `ImageGallery`'s illustrated fallback becomes the true empty state instead of the only state.
3. **Abandoned-pending-booking expiry** — a scheduled job (needs infrastructure this project doesn't have yet) releasing pending bookings past some TTL, and the `expired` status that would need.
4. **Live map** — implement `MapProvider` (Google Maps or Mapbox) and swap it into `MapPlaceholder`'s call sites; venues already have `latitude`/`longitude` columns ready.
5. **Admin tooling** — a real UI for the venue approval flow, replacing the direct-SQL `status` update.
6. **Owner booking management + payouts** — a real UI on top of the RLS access owners already have to their courts' bookings, plus Stripe Connect if payouts become a real requirement.

Phase 4B's booking/payment architecture (the exclusion constraint, the availability RPCs, the webhook-authoritative confirmation flow) is meant to absorb the above without a rewrite.
