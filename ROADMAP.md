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

## Suggested Phase 2

In rough priority order, based on what unblocks the most value next:

1. **Supabase integration** — real courts/reviews/amenities data behind the existing `types/court.ts` contract; real auth sessions behind `lib/services/auth.ts`.
2. **Real search** — connect the Explore filters and hero `SearchBar` to actual querying (currently client-side filtering over mock data).
3. **Live map** — implement `MapProvider` (Google Maps or Mapbox) and swap it into `MapPlaceholder`'s call sites.
4. **Real booking flow** — a booking record, conflict handling for double-booked slots, and a functioning `/bookings` list.
5. **Payments** — implement `PaymentProvider` with Stripe behind `BookingPanel`'s existing call to `createCheckout`.
6. **Venue owner onboarding** — the actual "List Your Court" flow (venue creation, court/schedule management), replacing today's marketing-only page.
7. **Reviews** — letting players actually submit a review after a completed booking.

Phase 2 should not need to restructure routing, the design system, or the mock-data-shaped types — those were built to absorb a real backend without a rewrite.
