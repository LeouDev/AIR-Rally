# Air/Rally

**Play More. Rally More.**

Air/Rally is a marketplace for pickleball court discovery and booking — discover a court, see real availability, book it instantly. Think Airbnb's ease, Uber's simplicity, and the polish of a premium modern sports app, built specifically for pickleball.

This repository contains **Phase 1: Project Foundation & Product Shell** — a production-quality foundation and a polished, functional first version of the product shell. See [ROADMAP.md](./ROADMAP.md) for what's in Phase 1 versus later phases.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Icons:** Lucide
- **Animation:** Framer Motion
- **State:** Zustand (used only where client state is genuinely needed — see [ARCHITECTURE.md](./ARCHITECTURE.md))
- **Forms:** React Hook Form + Zod
- **Backend:** none yet — Supabase-ready architecture (see below)

No paid external services or API keys are required to run this project.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts:

```bash
npm run build       # production build
npm run start       # run the production build
npm run lint        # ESLint
npm run test        # Jest + React Testing Library
npm run test:watch  # Jest in watch mode
```

## Project structure

```
src/
  app/
    (marketing)/       # routes that use the full AppShell (nav + footer + mobile tabs)
      page.tsx          # landing page ("/")
      explore/
      courts/[id]/
      bookings/
      favorites/
      profile/
      list-your-court/
    (auth)/             # routes with a minimal, centered auth layout
      login/
      signup/
      forgot-password/
  components/
    ui/                 # shadcn/ui primitives
    layout/              # Navbar, MobileNav, Footer, AppShell, Logo
    court/                # CourtCard, CourtSurface, Rating, ImageGallery, ...
    search/               # SearchBar, FilterBar, MapPlaceholder
    marketing/            # landing page sections
    shared/               # SectionHeader, EmptyState, LoadingSkeleton
  lib/
    mock-data/          # mockCourts, mockReviews, mockAmenities, mockLocations
    services/            # maps.ts, payments.ts, auth.ts — provider abstractions (see ARCHITECTURE.md)
    utils.ts
  store/
    useFavoritesStore.ts # the one piece of real client state in Phase 1
  types/
    court.ts
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reasoning behind these decisions and [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) for the visual language.

## Brand assets

Source logo files live in [`brand-source/`](./brand-source) at the repo root (not shipped to the client — see `public/brand/` for the derived, optimized assets actually used by the app: the icon mark, favicon, and Open Graph image).

## What's real vs. mocked

- **Real:** navigation, routing, responsive layout, favoriting (persisted to `localStorage` via Zustand), search/filter UI on Explore (filters the mock dataset client-side), form validation on auth screens.
- **Mocked:** all court/review/amenity data (`src/lib/mock-data`), maps (static placeholder), payments (stub that reports "not connected yet"), authentication (UI only, no session is created).

Full breakdown in [ROADMAP.md](./ROADMAP.md).
