# Air/Rally

**Play More. Rally More.**

Air/Rally is a marketplace for pickleball court discovery and booking — discover a court, see real availability, book it instantly. Think Airbnb's ease, Uber's simplicity, and the polish of a premium modern sports app, built specifically for pickleball.

This repository is through **Phase 2: Authentication & Supabase Foundation** — real Supabase Auth, user profiles, a full database schema with Row Level Security, protected routes, and the beginning of venue owner onboarding, layered on top of the Phase 1 product shell. See [ROADMAP.md](./ROADMAP.md) for what's built versus what's still ahead.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Icons:** Lucide
- **Animation:** Framer Motion
- **State:** Zustand (used only where client state is genuinely needed — see [ARCHITECTURE.md](./ARCHITECTURE.md))
- **Forms:** React Hook Form + Zod
- **Backend:** Supabase — Postgres, Auth, Row Level Security (see [Supabase setup](#supabase-setup) below)

The app **starts and runs with zero configuration** — landing, Explore, and Court Details are still fully mock-data-driven and need no environment variables at all. Supabase credentials are only required to exercise sign-up/sign-in, the profile page, and venue owner onboarding; without them those screens show a friendly "not set up yet" message instead of crashing (see [ARCHITECTURE.md](./ARCHITECTURE.md#fails-gracefully-without-supabase-configured)).

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
2. In the Supabase dashboard, open **SQL Editor** and run every file in [`supabase/migrations/`](./supabase/migrations) **in filename order** (they're numbered). Alternatively, if you have the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed and linked to your project: `supabase db push`.
3. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
4. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from **Project Settings → API** in the Supabase dashboard. Both are safe to expose to the browser — the anon key only works within the Row Level Security policies defined in the migrations.
5. Restart `npm run dev`.

That's it — sign-up, sign-in, password reset, the profile page, and venue draft creation now work against your project. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how authentication, roles, and RLS fit together, and [How to create the first admin](./ARCHITECTURE.md#how-to-create-the-first-admin) for promoting an account.

No `SUPABASE_SERVICE_ROLE_KEY` is needed for anything in this repo today — see `.env.example`.

## Project structure

```
src/
  app/
    (marketing)/       # routes that use the full AppShell (nav + footer + mobile tabs)
      page.tsx          # landing page ("/") — static, mock-data-driven
      explore/           # static, mock-data-driven
      courts/[id]/       # static, mock-data-driven
      bookings/          # protected (proxy-redirected); static empty state
      favorites/         # protected (proxy-redirected); local favorites (see ARCHITECTURE.md)
      profile/           # protected + dynamic — real Supabase profile
      list-your-court/   # dynamic — real venue draft form when signed in
    (auth)/             # routes with a minimal, centered auth layout
      login/ signup/ forgot-password/ reset-password/
    auth/callback/      # Route Handler — exchanges Supabase email-link codes for a session
  components/
    ui/                 # shadcn/ui primitives
    layout/              # Navbar, MobileNav, Footer, AppShell, Logo, UserMenu, AuthNavSection
    court/                # CourtCard, CourtSurface, Rating, ImageGallery, ...
    search/               # SearchBar, FilterBar, MapPlaceholder
    marketing/            # landing page sections
    profile/              # ProfileForm
    owner/                # VenueOnboardingForm, OwnerVenueList
    shared/               # SectionHeader, EmptyState, LoadingSkeleton
  lib/
    mock-data/          # mockCourts, mockReviews, mockAmenities, mockLocations — still power Explore/Landing/Court Details
    supabase/            # client.ts (browser), server.ts (server), middleware.ts, auth.ts, types.ts
    services/             # profiles.ts, favorites.ts, venues.ts, courts.ts, reviews.ts, maps.ts, payments.ts
    actions/              # Server Actions: auth.ts, profile.ts, venue.ts
    validations/          # Zod schemas shared by client forms and server actions
    errors.ts             # raw-error -> friendly-message mapping
    site.ts               # absolute-URL helper for auth email redirects
  store/
    useFavoritesStore.ts # local favorites for the still-mock-data CourtCard grid
  types/
    court.ts             # mock domain types
  proxy.ts               # session refresh + protected-route redirects (Next 16's proxy, formerly middleware)
supabase/
  migrations/            # numbered SQL migrations — schema, triggers, RLS policies
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reasoning behind these decisions and [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) for the visual language.

## Brand assets

Source logo files live in [`brand-source/`](./brand-source) at the repo root (not shipped to the client — see `public/brand/` for the derived, optimized assets actually used by the app: the icon mark, favicon, and Open Graph image).

## What's real vs. mocked

- **Real:** navigation, routing, responsive layout, Supabase email/password auth (sign up, sign in, sign out, password reset), user profiles (view + edit, backed by Postgres with RLS), protected routes, venue owner draft submission, search/filter UI on Explore (filters the mock dataset client-side), form validation on every form (client + server).
- **Mocked:** all court/venue/review/amenity data shown on Explore, the landing page, and Court Details (`src/lib/mock-data`) — a real `venues`/`courts`/`reviews` schema exists in Supabase, but nothing reads from it in the UI yet; maps (static placeholder); payments (stub that reports "not connected yet"); avatar upload (URL field only, no Supabase Storage yet).

Full breakdown in [ROADMAP.md](./ROADMAP.md).
