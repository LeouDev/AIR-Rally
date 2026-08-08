# Architecture

This document explains the structural decisions behind the foundation and why they were made, so later phases can extend the app without a rewrite. Phase 1 sections remain below; Phase 2 (Supabase, auth, roles, RLS) follows.

## Route groups: `(marketing)` vs `(auth)`

`src/app` splits into two route groups that don't affect the URL but do control layout:

- **`(marketing)`** wraps every player-facing page (landing, explore, court details, bookings, favorites, profile, list-your-court) in `AppShell` — the sticky `Navbar`, `Footer`, and mobile bottom tab bar.
- **`(auth)`** wraps `login`, `signup`, `forgot-password`, and `reset-password` in a minimal centered layout: just the logo and a card. Auth flows don't need marketing chrome, and a bottom tab bar makes no sense before someone has an account.

`src/app/auth/callback/route.ts` sits outside both groups — it's a Route Handler, not a page, and is the landing point for every Supabase email link (see [Authentication flow](#authentication-flow)).

This keeps `AppShell` a single source of truth for the main navigation instead of every page deciding for itself whether to render it.

## Provider abstractions (`src/lib/services`)

Phase 1 introduced three integration points that weren't built yet: maps, payments, and authentication, each behind a small interface.

- **`maps.ts`** — unchanged in Phase 2. `MapProvider` interface, `activeMapProvider` still `null`. `<MapPlaceholder />` renders instead of a live map.
- **`payments.ts`** — unchanged. `PaymentProvider` interface with `createCheckout()`; the booking UI already calls it, the stub returns `{ status: "unavailable" }`.
- **`auth.ts`** (the old `AuthProvider` interface) — **superseded in Phase 2**. It was deliberately unimplemented in Phase 1 with a note that Supabase Auth would replace it. That's now done: see [Authentication flow](#authentication-flow) below. The interface pattern itself was retired in favor of Supabase's own typed client, which already provides the right shape.

## Mock data (`src/lib/mock-data`) and the services layer (`src/lib/services`)

All court, review, amenity, and location data shown on the landing page, Explore, and Court Details still lives in `src/lib/mock-data` (`courts.ts`, `reviews.ts`, `amenities.ts`, `locations.ts`), typed against `src/types/court.ts`. **This was a deliberate Phase 2 scope boundary, not an oversight** — the brief explicitly asked to keep that UI intact and build the data-access seam without wiring it up yet, since a real booking engine (which the venue/court data really exists to support) is still a later phase.

`src/lib/services/{venues,courts,reviews,favorites,profiles}.ts` is that seam. Two different states live there side by side:

- **`profiles.ts` and `favorites.ts`** are fully real — every function queries Supabase, and `favorites` genuinely persists per-user (see [Two favorites systems](#two-favorites-systems-a-deliberate-seam) below for why the UI doesn't use it everywhere yet).
- **`venues.ts`, `courts.ts`, `reviews.ts`** mix real writes with not-yet-wired reads. `createDraftVenue` and `listVenuesByOwner` are real and power `/list-your-court`. `getVenueById`, `listActiveVenues`, `listCourtsByVenue`, and `listReviewsByVenue` are real, RLS-respecting queries against real tables — but no page calls them yet, because the page that would (a Supabase-backed Explore/Court Details) is out of scope until mock data actually gets replaced. Each has a one-line comment saying exactly that.

When that swap happens, it's a change to which function a component calls, not a new abstraction to invent — the services already exist and are already tested against the real schema.

## Court imagery: illustration, not stock photos

Unchanged from Phase 1. No venue photo upload flow exists yet (schema is ready — see `court_images` below — but there's no Supabase Storage integration or upload UI). `<CourtSurface />` renders a deterministic SVG illustration instead of stock photography, so nothing ever 404s.

## State management

Two client stores now exist for related-but-different reasons:

- **`useFavoritesStore`** (Zustand + `localStorage`) — unchanged from Phase 1. Powers the heart icon on `CourtCard` across the still-mock-data landing/Explore grids.
- **Supabase's own session state** — the source of truth for "am I logged in," read via `supabase.auth.getUser()` server-side (pages, actions) or client-side (`AuthNavSection`, `reset-password`). Not duplicated into Zustand; there's no reason to mirror session state into a second store when Supabase already manages it (including cross-tab sync via `onAuthStateChange`).

Everything else — Explore filters, the mobile map/list toggle, every form — stays local `useState`/React Hook Form. Zustand is for client state that's *actually necessary*, not a default.

## Styling: Tailwind v4 CSS-first tokens

Unchanged. See [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## Testing

Jest (via `next/jest`) + React Testing Library, not Vitest — see the Phase 1 note preserved below. Phase 2 adds mocked-Supabase-client unit tests for the services layer (`src/lib/services/__tests__`, helper in `src/lib/test-helpers/mockSupabase.ts`), Zod schema tests for every validation module, an error-mapping test, and a real (non-mocked) test of the proxy's redirect logic using an actual `NextRequest`.

> Vitest was tried first and hit a real bug in this specific checkout: its Vite-based module resolution mis-parses the colon in this directory's path (`AIR:Rally` — the literal POSIX name behind the Finder-displayed `AIR/Rally`), so `import()` of every test file fails with `Cannot find module '/some/truncated/path'` no matter how the config is written. `next/jest` uses Next's own SWC-based transform and Node's plain `require`, which don't hit this.

## Design principles carried into code

- **No premature abstraction.** Search filters live in `FilterBar`'s own local state shape (`ExploreFilters`), not a generalized filter-engine. Booking is a single-slot selection, not a cart.
- **No fake functionality.** Anything not built (payments, real maps, the owner dashboard, review submission) says so in the UI rather than pretending to work.
- **One court data model.** `types/court.ts` is deliberately the only shape mock courts take, from mock data through every component — no per-page reshaping.

---

# Phase 2: Authentication & Supabase Foundation

## Supabase client architecture (`src/lib/supabase`)

Four small, single-purpose files rather than one shared client, because Next.js's server/client boundary genuinely needs different cookie-handling code on each side:

- **`client.ts`** — `createClient()` for Client Components, via `@supabase/ssr`'s `createBrowserClient`. Cookie handling is automatic.
- **`server.ts`** — `createClient()` (async) for Server Components, Server Actions, and Route Handlers, via `createServerClient` wired to `next/headers` `cookies()`. A fresh client per request, never a shared singleton — that's the documented Supabase SSR pattern, not an oversight.
- **`middleware.ts`** — `updateSession()`, called from `proxy.ts` (see below). Refreshes the session on every request and redirects unauthenticated requests away from protected routes.
- **`auth.ts`** — `getCurrentUser()` / `getCurrentUserWithProfile()`, safe read-only helpers for Server Components that display auth state without needing the full client/action machinery. Never throw — see [Fails gracefully without Supabase configured](#fails-gracefully-without-supabase-configured).
- **`env.ts`** — the one place that reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so every client gets the same clear error instead of a cryptic "Invalid URL" from supabase-js.
- **`types.ts`** — hand-written `Database` type matching `supabase/migrations/*.sql`. Regenerate it from a linked project with `npx supabase gen types typescript --linked` once you have one instead of hand-editing further.

## proxy.ts (not `middleware.ts`)

This Next.js version renamed the middleware file convention to `proxy` (`middleware.ts` → `proxy.ts`, `export function middleware` → `export function proxy`) — this is a real, documented breaking change in this Next release, not a typo. `src/proxy.ts` calls `updateSession()` on every request except static assets, which:

1. Re-validates the session via `supabase.auth.getUser()` (not `getSession()` — `getUser()` round-trips to Supabase Auth to verify the token; `getSession()` just trusts whatever's in the cookie, which is the wrong check to gate access on).
2. Redirects unauthenticated requests to `/profile`, `/bookings`, `/favorites`, or any nested path under them, to `/login?redirect=<original-path>`. Login sends the user back there on success.
3. **Fails closed** if Supabase isn't configured: protected paths redirect to `/login` rather than silently letting the request through. A misconfigured deployment should break loudly on protected routes, not open them up.

## Authentication flow

- **Sign up** (`lib/actions/auth.ts` → `signUp`) — `supabase.auth.signUp()` with `first_name`/`last_name`/`display_name` passed as user metadata and `emailRedirectTo` pointing at `/auth/callback`. If Supabase's email confirmation is enabled on the project (the default), `data.session` comes back `null` and the signup page shows a "check your email" state instead of redirecting in.
- **Email confirmation & password recovery** both land on `src/app/auth/callback/route.ts`, which exchanges the PKCE `code` query param for a session (`exchangeCodeForSession`) and redirects to `next` (defaults to `/`; password recovery passes `next=/reset-password`). One shared callback route for both flows, since both are "here's a code, turn it into a session, then go somewhere."
- **Login** (`signIn`) — `signInWithPassword`, then the client redirects to `?redirect=` or `/`.
- **Logout** (`signOut`) — `supabase.auth.signOut()`, called from `UserMenu` (a Client Component using `useTransition`), then `router.push('/')` + `router.refresh()` so the server-rendered parts of the page (like `/profile` if you happened to be there) re-fetch without a session.
- **Forgot / reset password** — `requestPasswordReset` calls `resetPasswordForEmail` (Supabase itself avoids confirming whether the email exists, so the UI always shows the same "check your email" message). The link routes through `/auth/callback?next=/reset-password`; `/reset-password` checks for a live session client-side and calls `updatePassword` (`supabase.auth.updateUser({ password })`) once the user submits a new one.

Every action validates with the same Zod schema the client form uses (`src/lib/validations/auth.ts`) — **again, server-side, independently of the client validation**, per the brief's instruction not to rely on client validation alone.

## Role system and authorization

Three roles: `player` (default for every new signup), `venue_owner`, `admin`. **No UI anywhere lets a user set their own role — there is no role field in `updateProfileSchema` or in the profile edit form at all.** Even if a client crafted a request with an extra `role` key, Zod strips unknown keys by default, so it's discarded before it reaches `lib/services/profiles.ts` — see the `"strips a role field even if a client sends one"` test in `src/lib/validations/__tests__/profile.test.ts`.

That's application-layer defense in depth. The real guarantee is at the database layer, because **client-side/application-layer checks are not trusted as the security boundary** — a `profiles_prevent_role_change` trigger (`supabase/migrations/20260809000001_profiles.sql`) silently reverts `role` to its previous value on any self-update, no matter what's sent. Only a request that isn't "acting as yourself" (i.e. an admin operation) can change it.

Venue status escalation follows the identical pattern for a different actor: a venue owner can freely edit their own venue, but a `venues_prevent_status_escalation` trigger blocks *them* from setting `status` to `active` or `suspended` — only `public.is_admin()` can. See the comment in `supabase/migrations/20260809000002_venues.sql` for why this had to be a trigger (comparing OLD vs NEW) rather than a `WITH CHECK` clause — the first draft of that policy would have also blocked owners from editing any *other* field of an already-active venue, which wasn't the intent.

## RLS strategy

Every table has Row Level Security enabled — there is no "allow everything" policy anywhere in the migrations. The shape is consistent across tables:

- **`public.is_admin()`** — a `SECURITY DEFINER` SQL function that checks `profiles.role = 'admin'` for `auth.uid()`. Called from policies instead of inlining the same subquery everywhere, and avoids the classic "infinite recursion detected in policy" trap you get from a policy on `profiles` querying `profiles` again directly.
- **Public read, owner write.** `venues`, `courts`, `venue_amenities`, `court_images`: publicly readable only when `status = 'active'` (or `'active'` court + `'active'` parent venue), always readable by the owner regardless of status, always readable by admins. Writes are scoped to `owner_id = auth.uid()` (or, for courts/images, "the venue this row belongs to is owned by me") via `EXISTS` subqueries.
- **`amenities`** — a small reference list (parking, lighting, Wi-Fi, etc., seeded in the migration itself), publicly readable, admin-only to modify.
- **`favorites`** — a user can only ever see, create, or delete their *own* rows. The composite primary key `(user_id, venue_id)` is both the index and the duplicate-prevention constraint — `favorites.ts`'s `addFavorite` catches the resulting `23505` unique-violation and treats it as a harmless no-op rather than an error (tested).
- **`reviews`** — publicly readable (needed so a review's author can eventually be shown), but a user can only insert/update/delete their own. `public_profiles`, a narrow view exposing just `(id, display_name, avatar_url)` from the otherwise locked-down `profiles` table, exists specifically so a review list can show *who* wrote a review without exposing `phone`/`email`/`role` — no page reads it yet since review display is still mock data, but it's there for when reviews go live.

`SUPABASE_SERVICE_ROLE_KEY` is never used anywhere in this codebase — every query goes through the anon key and is subject to the RLS policies above. It's commented out in `.env.example` and only worth adding once a real admin-only server operation needs it.

## How to run migrations

`supabase/migrations/*.sql` are plain, numbered SQL files (no Supabase CLI project scaffold, since there's no CLI/Docker available in this environment to verify one). Two ways to apply them to your own project:

- **SQL Editor (simplest):** open each file in filename order and run it in the Supabase dashboard's SQL Editor.
- **Supabase CLI:** `supabase link --project-ref <your-ref>` then `supabase db push`.

## How to create the first admin

There's deliberately no UI for this — role changes go through the database directly, consistent with "authorization enforced through database policies, not the client." After signing up normally (which creates a `player` profile via the `handle_new_user` trigger), run in the SQL Editor:

```sql
update public.profiles set role = 'admin' where id = '<their auth.users id>';
```

This bypasses the `profiles_prevent_role_change` trigger because it isn't a self-update executed as that user (`auth.uid()` inside the SQL Editor's session isn't the target row's `id`) — the same mechanism that blocks users from promoting themselves lets a database operator promote someone else.

## How venue ownership works

Any authenticated user can submit a venue via `/list-your-court` — becoming an "owner" isn't a separate role grant, it's just `owner_id = auth.uid()` on a row they created (enforced by the `venues` insert policy's `WITH CHECK`). The venue starts as `status = 'draft'`. There's no `venue_owner`-role gate on *creating* a draft; the role exists for later phases (e.g., an owner-only dashboard section in navigation) rather than for this specific action.

## Two favorites systems (a deliberate seam)

There are genuinely two independent favorites mechanisms right now, and that's intentional rather than an inconsistency:

1. **`useFavoritesStore`** (Zustand/`localStorage`) — drives the heart icon on every `CourtCard` shown on the landing page and Explore, because those cards represent **mock** courts with simple string ids (`"1"`, `"2"`, …) that don't correspond to any real `venues` row. Wiring that button to the real `favorites` table would either silently no-op (foreign key points nowhere) or require seeding fake venue rows just to make a button work — neither is honest.
2. **`lib/services/favorites.ts`** (real, Supabase-backed, RLS-protected) — fully implemented and tested (`addFavorite`/`removeFavorite`/`listFavoriteVenueIds`/`isFavorite`), ready for the moment a real venue exists to favorite. The `/favorites` **page** is still protected via `proxy.ts` per the brief's explicit route list, even though its content today reads the Zustand store, not Supabase — the redirect behavior is what's being demonstrated, and the page's content swaps to the real service in the same phase that swaps Explore off mock data.

## Static vs. dynamic rendering boundary

This mattered enough to be worth calling out: an early version of this phase made `Navbar` an `async` Server Component that called Supabase directly, so it could show a user menu vs. Sign In/Get Started. That works, but `Navbar` renders inside `AppShell`, which wraps *every* marketing page — including the landing page, Explore, and Court Details, none of which otherwise touch Supabase and are meant to stay statically generated (`next build` output shows them as `○ Static`). An async Supabase call in a layout-level component forces Next to treat everything under it as dynamically rendered per-request, silently turning the whole site dynamic just to decide which two nav buttons to show.

The fix: **`AuthNavSection`** is a Client Component that checks auth state on mount (and subscribes to `onAuthStateChange` for same-tab updates after login/logout) instead of the server doing it. This keeps `/`, `/explore`, and `/courts/[id]` statically generated exactly as in Phase 1, at the cost of a brief flash before hydration resolves — the standard, accepted trade-off for global-nav auth state without adopting Partial Prerendering (a much larger architectural change this phase didn't warrant). `/profile` and `/list-your-court`, which *do* need real per-user server data, are explicitly marked `export const dynamic = "force-dynamic"` rather than relying on Next to infer it — confirmed in `next build` output as `ƒ Dynamic` while the rest of the marketing group stays `○ Static`.

## Fails gracefully without Supabase configured

Every Supabase-touching code path — client-side (`AuthNavSection`, `/reset-password`) and server-side (every Server Action, via a shared `getServerClient()` helper in `lib/actions/auth.ts`) — catches the "missing env vars" error from `getSupabaseEnv()` and degrades to a normal signed-out UI state or a friendly inline error message ("Sign-in isn't set up yet — add your Supabase credentials to .env.local"), rather than an uncaught exception. This was a real bug caught during manual verification (the nav crashed the entire client bundle on first load with no `.env.local` present) and is now covered by keeping every `createClient()` call site behind a try/catch — see the `getServerClient()` pattern in `lib/actions/auth.ts` for the server-side version, reused by `lib/actions/profile.ts` and `lib/actions/venue.ts`.
