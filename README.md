# Air/Rally

**Play More. Rally More.**

Air/Rally is a marketplace for pickleball court discovery and booking — discover a court, see real availability, book it instantly. Think Airbnb's ease, Uber's simplicity, and the polish of a premium modern sports app, built specifically for pickleball.

This repository is through **Phase 4B: Booking UX + Payments** — a real customer booking flow (Court Details → pick a date/time → checkout → Stripe payment → a webhook-confirmed booking → confirmation page → My Bookings, plus cancellation), on top of Phase 4A's database-enforced double-booking guarantee and Phase 3's real marketplace. Both Phase 4B migrations are live, and the full payment/webhook flow has been verified end-to-end against real Stripe test-mode data. See [ROADMAP.md](./ROADMAP.md) for what's built versus what's still ahead.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Icons:** Lucide
- **Animation:** Framer Motion
- **Forms:** React Hook Form + Zod
- **Backend:** Supabase — Postgres, Auth, Row Level Security, Storage (see [Supabase setup](#supabase-setup) below)
- **Payments:** Stripe — hosted Checkout Sessions, webhook-verified confirmation (see [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments))

Zustand was removed in Phase 3 — favorites are now fully Supabase-backed, so there's no client state left that genuinely needs a store (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

The app **builds and typechecks with zero configuration**, but as of Phase 3 the landing page, Explore, Court Details, and Favorites all read real data from Supabase — without credentials configured they show a friendly "not set up yet" state rather than crashing, but you won't see any real venues (see [Supabase setup](#supabase-setup) below and [ARCHITECTURE.md](./ARCHITECTURE.md#fails-gracefully-without-supabase-configured)).

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). This works immediately with no setup — see [Supabase setup](#supabase-setup) below to enable authentication.

Other scripts:

```bash
npm run build       # production build
npm run start       # run the production build
npm run lint        # ESLint
npm run test        # Jest + React Testing Library
npm run test:watch  # Jest in watch mode
```

## Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, open **SQL Editor** and run every file in [`supabase/migrations/`](./supabase/migrations) **in filename order** (they're numbered) — each file on its own, not concatenated, since later files assume earlier ones already ran. Alternatively, if you have the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed and linked to your project: `supabase db push`. As of Phase 3 this includes `20260809000008_marketplace_view.sql` (the `venue_marketplace` view every player-facing page reads from) and `20260809000009_venue_images_storage.sql` (the `venue-images` Storage bucket) — without these two, Explore/landing/Court Details will error. As of Phase 4A it also includes `20260810000001` through `20260810000005` (venue timezones, operating hours, blocked periods, the `bookings` table and its double-booking-prevention constraint, and the availability RPC functions). As of Phase 4B it also includes `20260810000006` (adds `timezone` to the `venue_marketplace` view) and `20260810000007` (Stripe payment columns on `bookings`, the `confirm_booking_payment()` RPC) — without these two, the booking widget won't know a venue's timezone and Stripe payments can never be confirmed. See [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments).
3. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
4. Fill in `NEXT_PUBLIC_SUPABASE_URL` and a client key from **Project Settings → API** in the Supabase dashboard — either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (current-generation, `sb_publishable_...`) or `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy JWT format), whichever your project shows. Both are safe to expose to the browser — the client only works within the Row Level Security policies defined in the migrations.
5. Add your Stripe **test-mode** keys to the same `.env.local` — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (see `.env.example`, both from your Stripe dashboard in **test mode**). Booking checkout won't work without `STRIPE_SECRET_KEY`; the webhook endpoint won't confirm any payment without `STRIPE_WEBHOOK_SECRET`. Never use live-mode keys in development.
6. Restart `npm run dev`.

That's it — sign-up, sign-in, password reset, the profile page, and venue draft creation now work against your project. This exact flow has been verified end-to-end against a real Supabase project — see [ARCHITECTURE.md](./ARCHITECTURE.md#phase-25-real-supabase-connection--end-to-end-verification) for the verification results, how authentication/roles/RLS fit together, and [How to create the first admin](./ARCHITECTURE.md#how-to-create-the-first-admin) for promoting an account.

No `SUPABASE_SECRET_KEY` (formerly "service role key") is needed for anything in this repo today — see `.env.example`.

### Demo data (optional)

The marketplace is empty until real venues exist. [`supabase/seed.sql`](./supabase/seed.sql) adds 3 realistic demo venues (clearly named `[DEMO] ...`), 8 courts, amenity links, 4 reviews, and (as of Phase 4A) 28 operating-hours windows — safe to run multiple times (idempotent) and easy to remove later (`delete from public.venues where name like '[DEMO]%'` cascades everything else). It's optional and not run automatically — see the header comment in the file for exact run instructions. Requires the specific account named at the top of the script (edit `target_email` there if needed) to already exist in the project. **Operating hours specifically are needed for the booking engine to have anything to compute against** — a court with zero operating-hours rows is never bookable.

### Verifying the double-booking guarantee (optional, manual)

[`scripts/verify-no-double-booking.ts`](./scripts/verify-no-double-booking.ts) races two real, concurrent booking attempts against the live database and asserts exactly one succeeds. It's a standalone script, not part of `npm test` — there's no local Postgres available in this project's dev environment to run a true concurrency test automatically (see [ARCHITECTURE.md](./ARCHITECTURE.md#testing-strategy--the-honest-version)). Run it with `npx ts-node scripts/verify-no-double-booking.ts` after setting the environment variables documented in its header comment (credentials are read from your shell environment only — the script never asks for or hardcodes a password).

### Verifying the Stripe payment/webhook flow (optional, manual)

[`scripts/verify-stripe-webhook-flow.ts`](./scripts/verify-stripe-webhook-flow.ts) proves Phase 4B's payment flow against real Stripe test-mode data and the real webhook route — not just mocks. Run in two steps (`create`, then `confirm` after manually paying with Stripe's test card on the real Checkout page it prints a URL for) — see the header comment for full instructions and required environment variables. Already run once and passed; see [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments) for the result.

> **Free-tier email rate limits:** Supabase's built-in SMTP allows only a handful of auth emails per hour. If you hit "Too many attempts" while testing signup/password-reset repeatedly, wait for the limit to reset or add a custom SMTP provider in your project's Auth settings.

## Project structure

```
src/
  app/
    (marketing)/       # routes that use the full AppShell (nav + footer + mobile tabs)
      page.tsx          # landing page ("/") — dynamic, real FeaturedCourts
      explore/           # dynamic — real search/filter/sort/pagination, URL state
      courts/[id]/       # dynamic — real venue detail, generateMetadata, notFound(); real BookingWidget (Phase 4B)
      bookings/          # protected (proxy-redirected) + dynamic — real My Bookings list, cancellation (Phase 4B)
      bookings/[bookingId]/confirmation/  # dynamic — post-checkout confirmation page; reconciles a still-pending booking against Stripe (Phase 4B)
      favorites/         # protected (proxy-redirected); real, Supabase-backed
      profile/           # protected + dynamic — real Supabase profile
      list-your-court/   # dynamic — create a venue draft; list the signed-in owner's venues
      list-your-court/[venueId]/  # dynamic — owner-only: edit venue, amenities, manage courts
    (auth)/             # routes with a minimal, centered auth layout
      login/ signup/ forgot-password/ reset-password/
    api/stripe/webhook/  # Route Handler — the sole authority for "was this booking paid for" (Phase 4B)
    auth/callback/      # Route Handler — exchanges Supabase email-link codes for a session
  components/
    ui/                 # shadcn/ui primitives
    layout/              # Navbar, MobileNav, Footer, AppShell, Logo, UserMenu, AuthNavSection
    court/                # CourtCard, CourtSurface, Rating, ImageGallery, FavoriteButton, BookingWidget, CancelBookingButton, ...
    search/               # SearchBar, FilterBar, MarketplaceSearchInput, SortSelect, ExplorePagination, ExploreLayout
    marketing/            # landing page sections (FeaturedCourts is now an async Server Component)
    profile/              # ProfileForm
    owner/                # VenueForm (create/edit), OwnerVenueList, VenueAmenitiesEditor, CourtFormDialog, CourtsManager
    shared/               # SectionHeader, EmptyState, LoadingSkeleton
  lib/
    mock-data/          # locations.ts only (static UI data for the city picker) — courts/reviews/amenities removed in Phase 3
    supabase/            # client.ts (browser), server.ts (server), middleware.ts, auth.ts, types.ts
    services/             # profiles.ts, favorites.ts, venues.ts, courts.ts, amenities.ts, reviews.ts, images.ts, availability.ts, bookings.ts, maps.ts, payments.ts (real Stripe Checkout, Phase 4B)
    actions/              # Server Actions: auth.ts, profile.ts, venue.ts, court.ts, favorites.ts, booking.ts, checkout.ts, availability.ts
    validations/          # Zod schemas shared by client forms and server actions
    explore-params.ts    # URL <-> MarketplaceFilters parse/serialize (single source of truth for shareable search)
    hooks/useExploreFilters.ts  # shared client hook wrapping explore-params + next/navigation
    booking-config.ts    # single source of truth for booking business-rule constants (Phase 4A)
    errors.ts             # raw-error -> friendly-message mapping
    site.ts               # absolute-URL helper for auth email redirects and Stripe success/cancel URLs
  types/
    court.ts             # CourtSurfaceColor (illustration palette) + Location (static city list) — that's all that's left
  proxy.ts               # session refresh + protected-route redirects (Next 16's proxy, formerly middleware)
scripts/
  verify-no-double-booking.ts  # manual, live-database concurrency proof (Phase 4A) — not part of npm test
  verify-stripe-webhook-flow.ts  # manual, live Stripe TEST MODE payment + webhook proof (Phase 4B) — not part of npm test
supabase/
  migrations/            # numbered SQL migrations — schema, triggers, RLS policies, the marketplace view, Storage, the booking engine, Stripe payment columns + confirm_booking_payment() (Phase 4B)
  seed.sql               # optional demo data — venues/courts/amenities/reviews/operating hours, never run automatically
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reasoning behind these decisions and [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) for the visual language.

## Brand assets

Source logo files live in [`brand-source/`](./brand-source) at the repo root (not shipped to the client — see `public/brand/` for the derived, optimized assets actually used by the app: the icon mark, favicon, and Open Graph image).

## What's real vs. mocked

- **Real, Supabase-backed, as of Phase 3:** navigation, routing, responsive layout, auth (sign up/in/out, password reset), profiles, protected routes; venue discovery — Explore search/filter/sort/pagination with URL state, the landing page's featured venues, Court Details (venue + courts + amenities + reviews + images); favorites (add/remove/list, fully persisted, sign-in-gated); venue owners can create a venue draft, edit their venue, manage its amenities, and create/edit/activate/deactivate its courts. See [ARCHITECTURE.md](./ARCHITECTURE.md#phase-3-real-court-marketplace) for the marketplace architecture and what was verified live.
- **Real, as of Phase 4A:** venue operating hours, per-court blocked periods, and a real `bookings` table with a database-enforced guarantee that two active bookings can never overlap on the same court (a Postgres exclusion constraint, not an application-level check).
- **Real, as of Phase 4B:** the full booking flow — Court Details' `BookingWidget` (real availability, date/duration/time selection), a real Stripe Checkout redirect, a webhook-verified confirmation page, a real My Bookings list, and real cancellation. Payment confirmation is authoritative only via a signature-verified Stripe webhook, never the browser's post-checkout redirect alone — verified end-to-end with a real test-card payment and a real, signature-verified webhook delivery against the live database. See [ARCHITECTURE.md](./ARCHITECTURE.md#phase-4b-booking-ux--payments) for what was tested.
- **Still mocked:** `src/lib/mock-data/locations.ts` — the city dropdown's option list is static UI data, not marketplace content, so there's nothing to migrate it to.
- **Not built (architecture prepared, not implemented):** a live map (`MapPlaceholder`), review *submission* (reads are real; writing a review is deferred until reviews can attach to a completed booking), a venue-owner booking dashboard, refunds/payouts/Stripe Connect.

Full breakdown in [ROADMAP.md](./ROADMAP.md).
