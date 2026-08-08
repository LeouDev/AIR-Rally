# Architecture

This document explains the structural decisions behind the Phase 1 foundation and why they were made, so later phases can extend the app without a rewrite.

## Route groups: `(marketing)` vs `(auth)`

`src/app` splits into two route groups that don't affect the URL but do control layout:

- **`(marketing)`** wraps every player-facing page (landing, explore, court details, bookings, favorites, profile, list-your-court) in `AppShell` — the sticky `Navbar`, `Footer`, and mobile bottom tab bar.
- **`(auth)`** wraps `login`, `signup`, and `forgot-password` in a minimal centered layout: just the logo and a card. Auth flows don't need marketing chrome, and a bottom tab bar makes no sense before someone has an account.

This keeps `AppShell` a single source of truth for the main navigation instead of every page deciding for itself whether to render it.

## Provider abstractions (`src/lib/services`)

Three integrations are explicitly **not** built in Phase 1: maps, payments, and authentication. Rather than leaving components to assume a specific vendor later, each has a small interface today:

- **`maps.ts`** — `MapProvider` interface, `activeMapProvider` currently `null`. `<MapPlaceholder />` renders instead of a live map. Swapping in Google Maps or Mapbox means implementing the interface and updating one component, not hunting through Explore and Court Details for map-shaped assumptions.
- **`payments.ts`** — `PaymentProvider` interface with `createCheckout()`. The booking UI (`BookingPanel`) already calls this; the stub implementation returns `{ status: "unavailable" }` and the UI shows that as a toast. Wiring up Stripe later means implementing `createCheckout` for real — the component doesn't change.
- **`auth.ts`** — `AuthProvider` interface, `activeAuthProvider` currently `null`. Deliberately **not implemented**: the login/signup/forgot-password forms validate with Zod and, on submit, show a "not connected yet" toast. No fake session is ever created. This was a specific instruction for Phase 1 — auth UI must be visually and structurally complete without any auth logic that could be mistaken for the real thing.

## Mock data (`src/lib/mock-data`)

All court, review, amenity, and location data lives in one place (`courts.ts`, `reviews.ts`, `amenities.ts`, `locations.ts`, re-exported from `index.ts`), typed against `src/types/court.ts`. Components import from `@/lib/mock-data`, never inline arrays. When Supabase queries replace this layer, the shape defined in `types/court.ts` is the contract to preserve — swap the data source, not the components that consume it.

## Court imagery: illustration, not stock photos

Phase 1 has no venue photo pipeline (no owner onboarding, no upload flow) and stock photography would either require external URLs (fragile, and against the "no broken images" bar) or downloaded assets we don't have rights to. Instead, `<CourtSurface />` renders a deterministic SVG illustration of an aerial court view, parameterized by surface color and indoor/outdoor. It's brand-consistent, never breaks, and scales to any size. Swap it for real photography once venue onboarding ships — `CourtCard`, `ImageGallery`, and the hero all consume it through one component.

## State management

Zustand is used in exactly one place: `useFavoritesStore`, because favoriting is genuine cross-page client state that needs to persist across a reload (backed by `localStorage`). Everything else — Explore filters, the mobile map/list toggle, form state — is local `useState`/React Hook Form, because it doesn't need to outlive the component that owns it. Per the project brief, Zustand is for client state that's *actually necessary*, not a default.

## Styling: Tailwind v4 CSS-first tokens

There is no `tailwind.config.ts`. Tailwind v4's CSS-first configuration means design tokens live as CSS custom properties in `src/app/globals.css`, mapped into Tailwind's `@theme inline` block. Colors are defined once as hex values in `:root` / `.dark` and consumed everywhere as semantic classes (`bg-primary`, `text-muted-foreground`, etc.) — see [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) for the palette itself and the reasoning behind it.

## Testing

Jest (via `next/jest`) + React Testing Library, not Vitest. Vitest was tried first and hit a real bug in this specific checkout: its Vite-based module resolution mis-parses the colon in this directory's path (`AIR:Rally` — the literal POSIX name behind the Finder-displayed `AIR/Rally`), so `import()` of every test file fails with `Cannot find module '/some/truncated/path'` no matter how the config is written. `next/jest` uses Next's own SWC-based transform and Node's plain `require`, which don't hit this. If this project is ever moved to a path without a colon, Vitest would likely work fine — but there's no reason to switch back.

## Design principles carried into code

- **No premature abstraction.** Search filters live in `FilterBar`'s own local state shape (`ExploreFilters`), not a generalized filter-engine. Booking is a single-slot selection, not a cart.
- **No fake functionality.** Anything not built (payments, real auth, real maps, owner dashboard) says so in the UI rather than pretending to work.
- **One court data model.** `types/court.ts` is deliberately the only shape courts take, from mock data through every component — no per-page reshaping.
