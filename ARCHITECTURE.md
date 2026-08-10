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
- **`auth.ts`** (the old `AuthProvider` interface) — **removed in Phase 2.5**. It was deliberately unimplemented in Phase 1 with a note that Supabase Auth would replace it; Phase 2 did that (see [Authentication flow](#authentication-flow) below) but left the now-dead file in place. Phase 2.5's code review caught it — nothing imported it — and deleted it rather than leave an unused interface around whose `getSession()` method name is exactly the insecure pattern documented below (`getUser()` vs `getSession()`).

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

---

# Phase 2.5: Real Supabase Connection & End-to-End Verification

Phase 2 built the entire Supabase foundation against mocked behavior (no live project was available). Phase 2.5 connected it to a real project (`hrpbjudsrqcgyrkkodop`) and verified it end-to-end — real signup, real login, real RLS enforcement, real cross-account attack attempts. This section documents what was actually tested, one real bug that live testing caught, and the environmental limitations encountered.

## Supabase key architecture: publishable/secret keys

Supabase has moved to a new API key format: `sb_publishable_...` (client-safe, replaces the JWT-format anon key) and `sb_secret_...` (server-only, replaces the service-role key), alongside asymmetric (ES256) JWT signing for user session tokens instead of the older shared-HMAC-secret (HS256) scheme. This project uses the new format. `getSupabaseEnv()` (`lib/supabase/env.ts`) now checks `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first and falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so either key type works depending on what a given project's dashboard shows under Settings → API. Both are genuinely public/client-safe — this is not a secret being exposed.

## How migrations were actually applied

The Supabase CLI is not usable in this environment: `supabase login` requires an interactive browser-based OAuth callback, and this environment's shell has no TTY to support that (confirmed — `LegacyLoginMissingTokenError: Cannot use automatic login flow inside non-TTY environments`). Rather than ask for a Personal Access Token (a more sensitive, account-wide credential than was necessary for this task), the 7 migration files were concatenated in order and run once through the Supabase dashboard's SQL Editor by the project owner. Schema landing was independently verified afterward (not just assumed from a "Success" message) by querying every expected table through the REST API — all 8 tables plus the `public_profiles` view returned `HTTP 200` where `404` had been returned before, and `amenities` contained exactly the 13 seeded rows.

## What was verified live (not mocked)

All of the following were exercised against the real project using a real test account (`galileouuu+airrallytestplayer1@gmail.com`, clearly identifiable, created through the actual signup UI):

- **Signup** — real `auth.users` row created, `raw_user_meta_data` correctly populated (first/last/display name), `handle_new_user` trigger correctly created the matching `profiles` row with `role = 'player'`.
- **Email confirmation** — this project has email confirmation enabled (Supabase's default). The confirmation link initially failed with `otp_expired` when clicked from a personal browser — traced to Gmail's automatic link-safety prescanning consuming single-use confirmation links before the user's own click (a well-known Supabase + Gmail interaction, not an app bug). The app's handling of that failure was itself verified: `/auth/callback` correctly redirected to `/login?error=auth-callback-failed`, which rendered the intended "That link is invalid or has expired" message rather than a raw error. The account ended up confirmed anyway (the prescan's own GET request completed the exchange).
- **Login / logout / session persistence** — real `signInWithPassword`, session survives a full page reload, protected routes correctly redirect before login and correctly become accessible after.
- **Password reset request** — real `resetPasswordForEmail` call succeeds; full click-through completion wasn't independently verified due to the same Gmail-prescan behavior described above. Documented as a limitation, not claimed as passing.
- **Profile read/edit/persistence** — real data loaded on `/profile` (including the correct `role: player` badge), a phone number edit was saved and confirmed present after a hard reload.
- **Row Level Security**, tested by making direct authenticated REST calls (not just reading policy source) as the real test user:
  - Self role-escalation: `PATCH /profiles` with `{"role":"admin"}` returned `200` (the row update itself is allowed) but the returned row still showed `role: "player"` — the `profiles_prevent_role_change` trigger silently reverted it, live, confirmed by a follow-up read.
  - Venue status self-escalation: same pattern — `PATCH` a freshly-created own venue to `status: "active"` returned the row with `status` still `"draft"`.
  - IDOR / identity spoofing: inserting a `favorites` row with someone else's `user_id`, and a `venues` row with a spoofed `owner_id`, both returned `403` with Postgres's `new row violates row-level security policy` — confirmed rejected at the database layer, not just hidden by the UI.
  - Anonymous visibility: an unauthenticated request could not see a `draft`-status venue or its courts (`[]`), while the authenticated owner could (`1 row`) — confirmed the public/owner visibility split works correctly, not just for the venue row but for its child courts too.
  - Favorites: add, duplicate-add (correctly `409` on the composite primary key, exactly what `lib/services/favorites.ts` is written to treat as a no-op), list, remove, list-after-remove — full cycle, real data.
  - Cascading delete: deleting the test venue correctly cascaded to its court and its `venue_amenities` link (`on delete cascade` confirmed working, not just declared).

## Known limitation: no live two-distinct-owner test

Creating a second real account (to test "owner A cannot modify owner B's venue" with two actual sessions) was blocked by Supabase's free-tier email rate limit ("Too many attempts") after the signup/password-reset testing above, both through the app's own signup flow and through the dashboard's "Add User." This was **not worked around** (e.g., by weakening the project's auth settings) — it's reported here as a genuine constraint instead.

This doesn't leave the underlying claim unverified, though: the owner-scoped UPDATE and DELETE policies on `venues`/`courts` use the exact same `owner_id = auth.uid()` (or the equivalent `EXISTS` check for courts) expression that was already proven, live, to reject a spoofed `owner_id` on INSERT. A second real account would have exercised the identical policy expression a second time, not a different one — high confidence, but flagged here rather than silently assumed.

## A real bug live testing caught: logout didn't update the nav

Manual verification found that after clicking "Log out," the account avatar remained in the navbar until a manual page reload — even though the session was, in fact, correctly destroyed (cookies were empty; `/profile` correctly redirected to login immediately after). Root cause: `signOut` was a Server Action running on the **server-side** Supabase client, which has no relationship to the **browser-side** client instance that `AuthNavSection` subscribes to via `onAuthStateChange` — a server-initiated sign-out doesn't fire a browser client's local listeners. Fixed by having `UserMenu`'s logout handler call the **browser** client's `supabase.auth.signOut()` directly instead — that both clears the same cookies (the browser client falls back to `document.cookie`, which the server client also reads) and correctly fires the local `onAuthStateChange` listener that updates the nav immediately. The now-unused `signOut` Server Action was removed rather than left as dead code. This is a good example of why the brief's insistence on testing against a real backend instead of only inspecting source mattered — this bug was invisible from code review alone.

## Test data hygiene

One test venue, its one test court, and one venue↔amenity link were created during RLS testing and deleted afterward using the test account's own (legitimate, RLS-scoped) delete permission — verified gone via a follow-up read. The test **auth account and profile row** were *not* deleted: deleting an `auth.users` row requires admin/service-role privileges, which this project deliberately never uses from application code (see [RLS strategy](#rls-strategy)). Removing it is a one-click action in the dashboard (Authentication → Users) if wanted — this is a call for the project owner, not something automated on their behalf.

---

# Phase 3: Real Court Marketplace

Phase 2/2.5 built real auth, profiles, and a full venue/court/amenity/favorites/reviews schema with RLS — but Explore, the landing page, and Court Details still rendered `src/lib/mock-data`. Phase 3's job was the swap: every player-facing marketplace surface now reads real Supabase data, and venue owners can create and manage real venues and courts. The booking engine, payments, and everything else on the "intentionally not implemented" list stayed exactly that — out of scope, not half-built.

## The public marketplace read model: `venue_marketplace`

Every player-facing query (`searchMarketplaceVenues`, `getVenueDetail`, `listFeaturedVenues`, `listFavoritedVenues`, `listActiveCities`) reads from `public.venue_marketplace` (`supabase/migrations/20260809000008_marketplace_view.sql`), not the `venues` table directly. It's a view, not a duplicated table, so there's one place — not every call site — that encodes "public" for a venue:

- `where v.status = 'active'` — a `draft`/`pending_review`/`suspended` venue simply isn't in the result set.
- `owner_id` is not a selected column — the public marketplace UI has no use for it, so there's nothing to accidentally leak.
- `starting_price` (`min(hourly_price) filter (where status = 'active')`) and `active_court_count` are computed in the view itself, so no page has to remember "only count active courts."
- `with (security_invoker = true)` — the view re-checks RLS on `venues`/`courts` for the querying role exactly as querying those tables directly would, rather than running with the view-owner's (elevated) privileges. Combined with the explicit `status = 'active'` filter above, that's defense in depth: two independent mechanisms agreeing on the same boundary, not one relying on the other.

Owner-facing code (`getVenueForOwner`, `listVenuesByOwner`, `listCourtsByVenue`) reads the real `venues`/`courts` tables instead, any status, because an owner needs to see and manage their own draft/inactive rows — RLS (`owner_id = auth.uid()`) is what actually scopes that, not application code.

## Search, filter, sort, pagination — and why the URL is the source of truth

`lib/explore-params.ts` is the one place URL search params turn into a `MarketplaceFilters` object and back (`parseExploreFilters` / `filtersToSearchParams`), used by both the server-rendered Explore page (to run the actual query) and the client controls (`FilterBar`, `MarketplaceSearchInput`, `SortSelect`) to initialize themselves from the current URL. Filter state lives in the URL, not React state, specifically so results are shareable and bookmarkable (`/explore?location=Cebu&indoor=true`) and survive browser back/forward — `useExploreFilters()` (`lib/hooks/useExploreFilters.ts`) is the shared hook every control uses instead of reimplementing "read the URL, write an updated URL back."

`searchMarketplaceVenues` (`lib/services/venues.ts`) composes: free-text search (venue name/city/address `ilike`, plus a court-name lookup unioned in via `.or()`), city/indoor-outdoor/price/rating filters, an amenity **AND**-intersection (a venue must have every selected amenity, not just one — computed via a pre-query grouping `venue_amenities` rows by venue and comparing the count to the number of selected amenities), and one of four sort modes. **"Recommended" is a deterministic ranking** (`average_rating` desc, then `review_count` desc as the tiebreaker), not a personalization or AI-anything — a venue with a 4.9 from 200 reviews outranks a fresh 5.0 from one review, and that's the whole rule.

Two input-sanitization details worth calling out specifically:

- **Filter-string injection.** A raw search term gets interpolated into a PostgREST `.or()` filter string (`name.ilike.%term%,city.ilike.%term%,...`) — without care, a user typing a string containing `,`/`(`/`)` could reshape that filter into something PostgREST wasn't meant to receive from user input (not SQL injection — PostgREST parameterizes the underlying SQL — but the equivalent risk one layer up). `sanitizeSearchTerm()` strips those three characters and truncates to 200 chars before any interpolation happens.
- **Amenity id validation.** `amenityIds` from the URL are filtered against a UUID regex before ever reaching a query — a non-UUID value is silently dropped rather than sent to Postgres.

Pagination is clamped server-side (`page` floored to ≥1, `pageSize` clamped to a 48-row maximum) regardless of what a client requests — the URL parser doesn't even expose a `pageSize` param, so in practice it's always the 12-row default; the clamp exists as a second layer in case a future caller does pass one.

Search and price-range inputs are debounced (400–500ms) client-side so typing doesn't re-run the server query on every keystroke. Both debounced components use a **remount-on-URL-change** pattern (`key={searchParams.toString()}` on an inner component) to reset their local input state when the URL changes externally (Reset button, browser back/forward) — not a `useEffect` that calls `setState` synchronously, which is flagged by this project's React Compiler lint rule (`react-hooks/set-state-in-effect`) as a cascading-render risk. This was a real fix made during Phase 3's validation pass, not a stylistic preference: the initial implementation used exactly that effect pattern and it originally passed review, but the lint rule (part of the standard `next lint` run, not a special check invented for this pass) caught it as an error, and the fix is the React-docs-recommended alternative for "reset state when a prop changes."

## Favorites: fully real, Zustand removed

`useFavoritesStore` (Zustand + `localStorage`, from Phase 1) is gone — deleted along with the now-empty `src/store/` directory, and the `zustand` package was uninstalled. It existed specifically because Phase 1/2's `CourtCard` rendered mock courts with string ids that didn't correspond to any real `venues` row, so a real favorites table had nothing to point at. Now that every `CourtCard` renders a real `venue.id`, there's no reason for a second, parallel favorites mechanism — `toggleFavoriteAction` (`lib/actions/favorites.ts`) is the only one, and `FavoriteButton` uses an optimistic update (flip immediately, revert on failure) via `useTransition`, not a client store, to feel instant.

An unauthenticated favorite attempt doesn't silently no-op: `toggleFavoriteAction` returns a "Sign in to save favorites" error, and `FavoriteButton` shows it as a toast with a "Sign In" action button that routes to `/login?redirect=<current-page>` — never a silent failure.

## Reviews: read-only, with an author-visibility subtlety

Review *submission* is still out of scope (deferred until reviews can attach to a completed booking — no booking engine exists yet), so `lib/services/reviews.ts` only reads. The one non-obvious part: showing a review's author name. `listReviewsByVenue` does **not** use a PostgREST embed (`reviews?select=*,profiles(...)`) — an embed would go through `profiles`' own RLS (own-row-only), which would silently return `null` for every author who isn't the current viewer, since RLS applies per-row even inside a join. Instead it runs a second, separate query against `public.public_profiles` — the narrow view (`id`, `display_name`, `avatar_url` only) that Phase 2 built for exactly this — and joins the two result sets in application code.

Ratings aren't computed live on every read: `venues.average_rating`/`review_count` are denormalized columns kept in sync by an `AFTER INSERT OR UPDATE OR DELETE` trigger on `reviews` (`update_venue_rating_stats`, from Phase 2). Phase 3 didn't need to touch this — it was already the correct "maintained aggregate field" architecture the brief asked for, not a blind trust of a stored value that could go stale, since the trigger is literally what keeps it from going stale.

## Images: real Storage integration, unexercised by design

`supabase/migrations/20260809000009_venue_images_storage.sql` creates a public `venue-images` Storage bucket with owner-scoped insert/update/delete policies (matched via `(storage.foldername(name))[1] = venues.id`, i.e. objects are expected at `venue-images/<venue_id>/<filename>`) and `lib/services/images.ts#getPublicImageUrl` turns a `court_images.storage_path` into a fetchable URL. **No upload UI exists yet** — this is the correct, real architecture built ahead of that, not a stub, but it genuinely can't be exercised end-to-end until an upload flow exists (a Phase 4+ concern). `ImageGallery` handles the current, honest state: zero images is not an error or a broken-image icon, it's the expected state for every real venue today, and renders the same deterministic illustrated `CourtSurface` fallback Phase 1 used for mock courts (`deterministicSurfaceColor(venue.id)` — a stable hash, so a given venue always gets the same illustration color, not a random one on every render).

## Venue and court ownership: the database is the boundary, not the server action

Every write path — `updateVenueAction`, `createCourtAction`, `updateCourtAction`, `setCourtStatusAction`, `setVenueAmenitiesAction` — follows the same shape established in Phase 2 for venue status: **no application-level "do you own this?" check**. The action validates input with Zod, confirms the caller is authenticated, and calls the service function with whatever id the client sent; RLS is what actually rejects a write to a venue/court/amenity-link the caller doesn't own (see the `owner_id = auth.uid()` / `exists (select 1 from venues where owner_id = auth.uid())` policies from Phase 2, unchanged in Phase 3). A mismatched id doesn't get a special "unauthorized" code path — it just fails at the database layer and surfaces through the same friendly-error mapping as any other write failure. This was deliberately verified, not just assumed, during Phase 3's security review (see below).

`setVenueAmenities` (`lib/services/amenities.ts`) replaces a venue's amenity set with a delete-then-insert rather than a diff — simpler, and both halves are scoped to the same `venue_id` so RLS protects the whole operation the same way a diff-based approach would.

## A real bug this phase caught: stale local state in `CourtsManager`

Live browser verification (not just the automated test suite) caught a real bug: `CourtsManager` originally copied its `courts` prop into `useState(courts)` once on mount. Adding, editing, or toggling a court's status all correctly write to the database and call `router.refresh()` — but `useState`'s initial value is only read on mount, so the re-fetched `courts` prop was ignored on every subsequent render, and the list only updated after a full page reload. Fixed by reading the `courts` prop directly instead of forking it into local state — there was never a legitimate reason to fork it, since nothing in the component does a local-only mutation independent of the server round-trip. This is exactly the class of bug the project's own instructions call out — invisible from source review alone, only caught by actually clicking through the feature in a browser against the real backend.

## Two smaller fixes from this phase's validation pass

- **Malformed venue id → 404, not a raw error page.** `getVenueDetail`/`getVenueForOwner` previously let a genuinely invalid UUID (e.g. `/courts/not-a-uuid`) propagate as a thrown Postgres error (`22P02: invalid_text_representation`), which correctly never leaked to the user (this project's `error.tsx` never shows raw error text) but did show the generic "Something went wrong" page instead of the intended not-found state. Both functions now catch that specific error code and return `null`, which the page already treats identically to "doesn't exist."
- **RHF + Zod, `capacity` field.** The court form's optional `capacity` number input needed to convert `""` to `undefined` rather than `NaN` before validation. The first draft used `z.preprocess()` in the schema itself, which resolved correctly at runtime but broke `zodResolver`'s `TFieldValues` type inference (the same class of issue documented in `validations/venue.ts` for why `z.coerce.number()` isn't used there either). Fixed by moving the conversion to the form's `register("capacity", { setValueAs: ... })` instead of the schema — the schema stays a plain `z.number().int().min(1).max(20).optional()`.

## Mock data audit (Phase 3 objective)

`src/lib/mock-data/{courts,reviews,amenities}.ts` were deleted outright — confirmed via a full repo grep that nothing outside the mock-data directory itself imported from them anymore, once Explore/Court Details/Favorites/FeaturedCourts were migrated to real services. `src/lib/mock-data/locations.ts` (and the matching `Location` type in `types/court.ts`) is the one file that's staying, deliberately: it's **static UI data** (the fixed list of cities `SearchBar`'s location dropdown offers), not marketplace content with a real-data equivalent to migrate to — there's no `select distinct city` query that would replace "a designer-curated list of cities to suggest," those are different things. `CourtSurfaceColor` (the illustration palette type) also stayed in `types/court.ts` for the same reason — it's not mock marketplace data, it's a UI constant. Every other mock type (`Court`, `Amenity`, `TimeSlot`, `DayAvailability`, `Review`, `CourtType` — all in the old `types/court.ts`) was confirmed orphaned and deleted alongside them.

## Testing: server actions need `@jest-environment node`, and a second `jest.mock` gotcha

Two environment-specific issues came up while writing Phase 3's test suite, worth documenting so they don't get rediscovered:

- **Server action files need the `node` test environment, not `jsdom`.** Every `"use server"` action file imports `next/cache` (for `revalidatePath`), which transitively needs Web-standard globals (`Request`, `TextEncoder`) that jsdom's test environment doesn't provide. `jest.setup.ts` now polyfills `TextEncoder`/`TextDecoder` globally, and every test file under `src/lib/actions/__tests__/` opens with a `/** @jest-environment node */` docblock to run in Node's environment instead, where these are natively available.
- **`jest.mock()` needs a relative path, not the `@/` alias, in this specific checkout.** `jest.mock("@/lib/actions/favorites", factory)` fails to resolve the module — but the exact same specifier works fine in a normal `import` statement, and works fine in `jest.mock()` too if written as a relative path (`"../../lib/actions/favorites"`). Root cause: this repo's absolute path contains a literal colon (`.../AIR:Rally`), and `jest.mock()`'s manual-mock resolver runs a different internal codepath from transform-time import resolution — one that breaks on the colon, the other doesn't. This is the same class of bug as the pre-existing Vitest resolver issue documented earlier in this file (colon breaks Vite's resolver too); every Phase 3 test file that mocks a module uses relative paths for that reason.

`src/lib/test-helpers/mockSupabase.ts` gained a second helper, `createTableMockSupabase`, alongside the original `createMockSupabase` — services like `getVenueDetail` and `searchMarketplaceVenues` query several different tables in one call (`venue_marketplace`, `courts`, `venue_amenities`, `amenities`, ...), which the original single-result mock couldn't represent; the new helper maps table name → canned result (or a queue of results, for a table queried more than once per call).

## Security review (Phase 3)

A dedicated pass specifically for IDOR, unauthorized modification, owner-id manipulation, RLS bypass, sensitive-data exposure, and query-param injection, covering every new migration and query added this phase:

- **Confirmed:** `venue_marketplace` never exposes `owner_id` (not selected in the view at all — not just filtered client-side); every owner-write action relies on RLS rather than an application-level check, and that RLS is the same proven `owner_id = auth.uid()` pattern already live-tested in Phase 2.5; search-term and amenity-id inputs are sanitized/validated before reaching a query (see above); Storage upload/update/delete policies correctly scope by `venue_id` matched against `venues.owner_id = auth.uid()`; no service function does a blind `select *` that exposes more than a caller should see (owner-facing functions correctly use the full `venues`/`courts` tables since the caller is the owner; player-facing functions correctly use the `venue_marketplace` view).
- **Fixed as a direct result of this review:** the malformed-UUID → generic-error-page gap described above (not a security hole — no data was ever exposed — but "invalid params" handling the brief explicitly asked for).
- **No new RLS policy changes were needed or made** — every Phase 3 write path fits inside the RLS shape Phase 2 already established.

## Operational note (Phase 3): migrations 008/009 and this phase's live verification

`20260809000008_marketplace_view.sql` and `20260809000009_venue_images_storage.sql` were written early in this phase but not applied to the live project until Phase 3's live-verification pass, when `venue_marketplace`'s absence surfaced as a real `PGRST205: Could not find the table 'public.venue_marketplace' in the schema cache` error on every marketplace page. Applied via the SQL Editor (same method as Phase 2.5, since the Supabase CLI still isn't usable in this environment — see that section above), one file at a time — a first attempt that concatenated the *entire* migration history (including already-applied files 001–007) correctly failed with `relation "profiles" already exists`, which is the expected, safe behavior of re-running a `create table` statement against a table that's already there, not a sign of a broken migration. Once applied, `getFeaturedVenues`, Explore, and Court Details all loaded correctly, and the live venue/court/amenity CRUD verification in the section above proceeded against a real, populated project.

---

# Phase 4A: Availability + Booking Engine Foundation

Phase 3 shipped a real marketplace with hourly pricing shown as *display only* — no way to actually reserve a court. Phase 4A builds the database-level foundation that makes a real reservation possible: venue timezones, operating hours, blocked periods, and a `bookings` table. **No booking UI, no payments** — this phase is schema, service layer, and proof that the one requirement that actually matters is met: two users can never successfully book the same court for overlapping times.

## Timezone strategy

`venues.timezone` (new column, `supabase/migrations/20260810000001_venues_timezone.sql`) is an IANA identifier — `"Asia/Manila"`, never `"GMT+8"` or `"PST"`. An offset or abbreviation can't express daylight saving time; an IANA identifier is a rule set ("this region observes DST between these dates, with this offset before/after") that Postgres's `AT TIME ZONE` operator already knows how to apply correctly for any specific date, including across a DST transition. **Courts inherit their venue's timezone** — there's no `courts.timezone` column, because nothing in this product needs a court to run on a different clock than the rest of its venue.

All *instant* columns (`bookings.start_time`/`end_time`, `court_blocked_periods.start_time`/`end_time`) are `timestamptz` — Postgres always stores these as UTC internally regardless of session settings, which *is* "UTC timestamps for actual booking instants." Operating-hours times are plain `time` (`08:00`, not an instant) — they only become a real moment once combined with a specific calendar date and interpreted via `AT TIME ZONE` inside the availability functions below.

The `venues.timezone` migration backfills every existing row to `'Asia/Manila'` in the same `ADD COLUMN ... DEFAULT` statement — this is a correct backfill, not a guess: every venue in this database (the 3 `[DEMO]` venues plus the one real test venue) has a Philippines address.

**No new npm dependency was added for this.** The TypeScript layer doesn't do its own timezone arithmetic in Phase 4A — it passes a local-date string and duration through to a Postgres RPC, which does all the actual `AT TIME ZONE` conversion. `date-fns` (already a dependency) is unused for anything timezone-specific; a dedicated timezone library (`@date-fns/tz`, `luxon`) will make sense once a real booking UI needs to *format* a UTC instant back into venue-local wall time for display — that's Phase 4B+ scope, not this one.

## Operating hours: venue-level, normalized, not a JSON blob

`venue_operating_hours` (`supabase/migrations/20260810000002_venue_operating_hours.sql`): one row per open window — `(venue_id, day_of_week, start_time, end_time)`. Multiple rows for the same day represent multiple windows (e.g. `06:00–12:00` and `13:00–23:00`, the `[DEMO] BGC Smash Pickleball` seed data's lunch-closure schedule); zero rows for a day means closed, with no separate "is_closed" flag needed. `day_of_week` is `0`–`6` matching Postgres's own `extract(dow from date)` (`0` = Sunday) specifically so the availability function can join on it without a translation table.

**This is venue-level, not per-court.** A facility's open/close hours are naturally uniform across its courts in this product — only *blocks* (below) need per-court granularity, since a single court can go down for maintenance while the rest of the venue stays open normally.

**Overnight windows (e.g. `22:00–02:00`, where close is "before" open) are explicitly out of scope** — a `check (end_time > start_time)` constraint rejects them outright rather than silently mishandling them. This is a real, documented limitation, not an oversight: a venue open past local midnight isn't representable in Phase 4A.

A `unique (venue_id, day_of_week, start_time)` constraint exists purely so seed data (and any future owner-management UI) has a natural idempotent-upsert target — overlapping/duplicate windows aren't a security or correctness hazard (the availability function just computes their union correctly either way), so this isn't enforced any more strictly than that.

## Blocked periods: per-court, not publicly readable directly

`court_blocked_periods` (`supabase/migrations/20260810000003_court_blocked_periods.sql`): `court_id`, `start_time`/`end_time` (`timestamptz` — a block is a specific real event on a specific date, not a repeating pattern), `reason`, `created_by`. Court-scoped rather than venue-scoped: a venue-wide closure is one block row per court at that venue, not a second parallel venue-level block table — there's no current requirement that justifies the extra surface.

**Unlike every other public-facing table in this schema, `court_blocked_periods` has no public SELECT policy.** A block's `reason` could plausibly contain something an owner wouldn't want a random visitor reading (a private event's client name, an internal maintenance note). Public availability is computed through the `SECURITY DEFINER` functions below, which read this table internally without ever exposing `reason`/`created_by` to the caller — the same defense-in-depth shape as `public_profiles` hiding `phone`/`email`/`role` from the base `profiles` table (Phase 2).

## Booking statuses: three, not five

`pending`, `confirmed`, `cancelled` — deliberately not the full `pending/confirmed/cancelled/completed/expired` set. `completed` would need a scheduled job marking past bookings done; no cron infrastructure exists in this project yet. `expired` implies a payment-hold TTL; no checkout flow exists yet (that's explicitly Phase 4B). Both are real, anticipated future needs, not invented ones — adding two enum values to a table with real rows later is a small migration, so there's no cost to deferring them until something actually produces or consumes them.

**Every booking Phase 4A creates goes straight to `confirmed`** — nothing gates confirmation on payment yet, so there's nothing for `pending` to mean today. `pending` is included in the schema now anyway because Phase 4B's checkout step needs it immediately, without another migration.

## THE guarantee: a partial exclusion constraint

This is the one thing this entire phase exists to prove:

```sql
create extension if not exists btree_gist;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));
```

`btree_gist` is needed so a GiST index can combine plain equality (`court_id`, a uuid) with the range-overlap operator (`&&`) — GiST natively supports range types, but combining it with equality on a non-range column needs the operator classes `btree_gist` adds. This is Postgres's own documented, canonical solution for exactly this problem ("prevent overlapping reservations"), not a novel technique.

**Range semantics — `'[)'`, half-open:** a range `[start, end)` includes its start instant but excludes its end instant. Two ranges overlap (`&&`) if and only if they share at least one instant under this definition. Worked through every case Phase 4A's own requirements list:

| Booking A | Booking B | Overlap? | Why |
|---|---|---|---|
| 7:00–8:00 | 7:00–8:00 | **Yes — B rejected** | Identical ranges trivially share every instant. |
| 7:00–8:00 | 7:30–8:30 | **Yes — B rejected** | Both contain [7:30, 8:00). |
| 7:00–9:00 | 7:30–8:00 | **Yes — B rejected** | B is wholly contained in A. |
| 7:00–8:00 | 8:00–9:00 | **No — both allowed** | A's range excludes 8:00 (half-open); B's range includes it starting at 8:00. They share no instant. This is what makes adjacent bookings work — "the 7–8am slot" and "the 8–9am slot" are back-to-back, not conflicting. |
| A confirmed, then A cancelled, then B books 7:00–8:00 | | **B allowed** | The `where (status in ('pending','confirmed'))` clause means a cancelled row is invisible to the constraint entirely — cancelling genuinely frees the slot, enforced by the constraint itself, not by application code remembering to filter cancelled rows elsewhere. |
| Court X, 7:00–8:00 | Court Y, 7:00–8:00 | **No overlap — both allowed** | Different courts; the `court_id with =` term means the constraint never compares across courts. |

This holds **unconditionally** — it is not an optimization, and it does not depend on any application code being correct. See "Testing strategy" below for how this was actually proven against the live database, not just asserted.

## Availability: computed in Postgres, not fetched-then-filtered in JavaScript

Two `SECURITY DEFINER` SQL functions (`supabase/migrations/20260810000005_availability_functions.sql`), for the same reason `public.is_admin()` already is (Phase 2): an anonymous browsing player needs correct availability without being able to `select *` from `bookings` or `court_blocked_periods` directly — those stay privacy-protected under their normal RLS. This is an established pattern in this codebase, not a new one.

- **`get_available_slots(court_id, local_date, duration_minutes, increment_minutes, min_lead_minutes)`** — returns every bookable `(start, end)` pair for one court on one local calendar date. Looks up the venue's timezone and that day's operating-hours windows, generates candidate start times at the configured increment inside each window, converts each to a UTC instant via `AT TIME ZONE` (correct across DST, since this is exactly what that operator is for), then excludes anything overlapping a block or an existing active booking — using the *exact same* `tstzrange`/`&&` semantics as the exclusion constraint itself, so a slot this function reports as available is provably insertable, not just probably. Scoped to one court and one date's window the whole way through — never "fetch every booking ever and filter in JS."
- **`is_court_time_bookable(court_id, start, end, min_lead_minutes, max_window_days)`** — the same underlying checks (hours, blocks, overlap, lead time, booking window) for one specific already-chosen interval. This is what `createBooking()` calls before attempting the insert — **purely as a UX nicety**, to return "that time isn't available" instead of a generic error. It is explicitly *not* the integrity guarantee: a concurrent request can still win the race between this check returning `true` and the insert actually running, and the insert — protected by `bookings_no_overlap` — is what catches that. `lib/services/bookings.ts` never treats this function's result as a substitute for handling the insert's own possible failure.

A request spanning a local midnight boundary is rejected by `is_court_time_bookable` (start and end must fall on the same local calendar date) — consistent with operating hours not supporting overnight windows.

**Duration/increment validation is not duplicated between TypeScript and SQL.** `lib/booking-config.ts` centralizes the numbers; `lib/services/bookings.ts` validates shape (is this a 30-minute-aligned, in-range duration) before ever calling into SQL, and the SQL functions assume they've already been given a syntactically sane interval — their job is availability-specific rules (hours/blocks/overlap/lead-time/window), not re-deriving duration math a second time in a different language.

## Booking creation: cheap checks first, one DB round trip, then the guarantee

`lib/services/bookings.ts#createBooking()`, called from `lib/actions/booking.ts#createBookingAction()` (same `ActionResult`/`getServerClient()` shape as every other action in this codebase). Ordered:

1. **Pure arithmetic, no query** — `start < end`, duration is a multiple of `SLOT_INCREMENT_MINUTES` and within `[MIN_DURATION_MINUTES, MAX_DURATION_MINUTES]`, `start` isn't already past, `start` respects `MIN_LEAD_TIME_MINUTES`, `start` respects `MAX_BOOKING_WINDOW_DAYS`. All from `lib/booking-config.ts` — one file, imported everywhere this matters, never re-declared.
2. **Two separate, non-embedded queries** for the court and then its venue (`courts` then `venues`, not a PostgREST embed). This is deliberate: a joined `courts.select("*, venues(...)")` applies the *embedded* table's RLS to the join itself, which would silently collapse "venue inactive" into "court not found" for a venue owner checking their own not-yet-active court (their owner-visibility branch of `courts`' RLS doesn't require the embedded venue row to also match). Two plain queries, both scoped by the same caller's RLS, keep that edge case honest. For an ordinary player, RLS already makes an inactive court/venue's row invisible either way, so `court_not_found` is the correct — and only truthful — signal they can receive; the finer `venue_inactive`/`court_inactive` distinction only ever surfaces for a caller (owner/admin) who's actually allowed to see it.
3. **Grid alignment**, checked in the venue's own local time via `Intl.DateTimeFormat` (not the raw UTC minute — those only coincide for whole-hour-offset zones, which is all of them today, but the check is written to be correct regardless).
4. **`is_court_time_bookable()`** — the pre-check described above.
5. **Price snapshot computed**, then the insert — with the actual overlap guarantee living in the constraint the insert hits, not in step 4.

Every failure mode above throws a typed `BookingError` (`reason: BookingErrorReason`, a fixed union — `court_not_found`, `venue_inactive`, `court_inactive`, `invalid_time_range`, `invalid_duration`, `past_time`, `lead_time_not_met`, `booking_window_exceeded`, `slot_unavailable`, `concurrent_conflict`, plus cancellation-specific reasons below) with an already-user-safe `message` — never a raw Postgres error reaching the action layer for a known case. `lib/errors.ts` also gained a `23P01` → `"That time slot is no longer available."` entry as a second-layer safety net for any future code path that might hit the same constraint without going through `createBooking()`.

## Price snapshot and money representation

`bookings.price_amount` is an **integer** (minor units — centavos), computed server-side from the court's **current** `hourly_price` at the moment of booking creation (`round(hourly_price * 100 * duration_minutes / 60)`), and never recalculated afterward. If a court's price later changes from ₱500/hr to ₱600/hr, every booking made before that change keeps the price it was actually made at — the row is a snapshot, not a live reference. `currency` defaults to `'PHP'` (`DEFAULT_CURRENCY` in `lib/booking-config.ts`), matching every venue/court currently in the database. No multi-currency handling exists or is needed yet. Money is never represented as a float anywhere in this path, for the standard reason floating-point isn't acceptable for currency math.

## Confirmation code

`bookings.confirmation_code` — an 8-character, non-sequential, human-friendly reference distinct from the primary key, generated by a `BEFORE INSERT` trigger (`upper(left(replace(gen_random_uuid()::text,'-',''), 8))`) unconditionally, so a client can never choose or influence it. Nothing displays it yet (no UI this phase) — it's cheap to add now and expensive to retrofit onto a table with real rows once a confirmation screen or email needs one in Phase 4B, mirroring the same "build the real architecture ahead of the UI that needs it" precedent as Phase 3's Storage bucket.

## RLS

Following the two patterns Phase 2 already established — ownership-scoped `using`/`with check`, plus a `BEFORE UPDATE` trigger (not a `WITH CHECK` clause) for guarding specific field/status transitions:

- **Select**: the booking's own user, **or** the venue owner of the court it's for (via `courts` → `venues` → `owner_id = auth.uid()` — the brief explicitly asks for venue owners to see bookings at their own courts), **or** an admin.
- **Insert**: `with check (auth.uid() = user_id)` — a booking can never be created on someone else's behalf.
- **Update**: `using/with check (auth.uid() = user_id or is_admin())`, **plus** `bookings_prevent_tampering` (a `BEFORE UPDATE` trigger, exactly the same shape as `profiles_prevent_role_change`/`venues_prevent_status_escalation` from Phase 2): for a non-admin, `court_id`/`user_id`/`price_amount`/`currency`/`start_time`/`end_time` silently revert to their prior value no matter what's sent, and the *only* status transition allowed is `pending|confirmed → cancelled` — any other attempted status change reverts too. When that one allowed transition happens, `cancelled_at`/`cancelled_by` are computed by the trigger itself (`now()`/`auth.uid()`), never trusted from whatever the client sent, so there's no field left to tamper with even on the transition that is permitted.
- **No delete policy** — a booking is only ever cancelled, never removed, the same posture as everything else in this schema (venues/courts are soft-stated via `status`, never hard-deleted once they matter).
- A venue owner can **see** bookings for their own courts (for a future manage-bookings UI) but cannot modify or cancel someone else's booking in Phase 4A — owner-initiated cancellation/refund is a policy question that belongs with payments (Phase 4B), not invented here ahead of that.

## Cancellation (foundation only)

`lib/services/bookings.ts#cancelBooking()`: a user may cancel their own booking any time before it starts. **This is a conservative development default, not a researched business policy** — no cancellation-window/fee policy exists yet, and this is documented as temporary rather than presented as a considered decision. Enforced in the service layer (a soft business rule, unlike overlap prevention, so it doesn't need to be a database constraint). `cancelled_at`/`cancelled_by` are set by the `bookings_prevent_tampering` trigger, not sent by the service — see RLS above.

## Testing strategy — the honest version

**There is no Docker or local Postgres available in this project's development environment** (the same constraint that's blocked Supabase-CLI-based migrations since Phase 2.5). That means there's no way to spin up a real ephemeral database and run true concurrent-`INSERT` integration tests inside the normal Jest suite. Two tiers follow from that, deliberately kept distinct rather than blurred together:

1. **Jest (mocked, same tier as all other tests in this project — 167 total after this phase)**: every validation branch in `createBooking`/`cancelBooking` (court/venue inactive, bad duration, outside operating hours signaled via `is_court_time_bookable` returning false, past time, lead time, booking window, price calculation, the `23P01` → `concurrent_conflict` mapping), the availability service's RPC call shape, and every server action's auth guard. This proves the *code* is correct — the right thing happens for each input — using the same mocked-Supabase-client approach every other service in this project is tested with.
2. **`scripts/verify-no-double-booking.ts`, run manually, never part of `npm test`/CI**: signs in as a real user, asks the live database for a real available slot via the actual `get_available_slots` RPC, then fires two genuinely concurrent `.insert()` calls at the same court/interval through the live project's real PostgREST API — the exact path a real user's browser would hit — and asserts exactly one succeeds and the other is rejected with `23P01`. This is the only thing that actually *proves* the live database's behavior rather than assuming it; it's kept separate from the automated suite for the same reason `supabase/seed.sql` is: it performs a real, deliberate action against the live project and should only ever run when a person means it to. See the script's own header comment for exact run instructions (credentials via environment variables only — never hardcoded, never pasted into chat). It cancels its own test booking afterward (bookings have no delete policy, by design, so "cancelled" — not "gone" — is the correct, honest cleanup state) and never touches the `[DEMO]` marketplace rows themselves.

## Known limitations (Phase 4A)

- **Overnight operating-hours windows aren't supported** (`end_time > start_time` is enforced at the schema level) — a venue open past local midnight can't be represented yet.
- **A booking can't span a local midnight boundary** — `is_court_time_bookable` rejects any interval whose start and end fall on different local calendar dates.
- **`get_available_slots` computes one calendar date at a time** — there's no multi-day range query yet; a future UI would call it once per date, which is straightforward but not implemented as a single wider RPC in this phase.
- **Booking creation and cancellation have no server-level rate limiting** — not evaluated as in-scope for this phase (matches the marketplace's existing posture from Phase 3).
- **Cancellation policy is a placeholder** ("before start time," no fee/window logic) — explicitly flagged above as needing a real product decision before Phase 4B.
- **No owner-facing "manage bookings" UI or service function** — RLS already grants owners read access to their courts' bookings (for exactly this, later), but nothing queries it yet.
- **`completed`/`expired` booking statuses don't exist** — see "Booking statuses" above for why, and what would need to exist first (a scheduled job; a checkout flow) to make them meaningful.

---

# Phase 4B: Booking UX + Payments

Phase 4A built the database-level guarantee (the exclusion constraint) and the availability RPCs, but there was still no way for a player to actually book anything — Court Details said "Online booking is coming in a future update." Phase 4B builds the real flow: Explore → Court Details → pick a date/time → booking summary → Stripe Checkout → payment → a webhook-confirmed booking → a confirmation page → My Bookings, plus cancellation. **No venue-owner booking dashboard, no payouts/Stripe Connect, no subscriptions, no promo codes, no `completed`/`expired` automation** — see "Intentionally not implemented (Phase 4B)" in [ROADMAP.md](./ROADMAP.md).

> **Status note:** both migrations below (`20260810000006`, `20260810000007`) have been applied to the live Supabase project and independently verified via read-only queries against the live schema (not just trusted from a "Success" message) — see "Two additive migrations" below. Live Stripe TEST MODE verification has also run and passed end-to-end — see "Testing" below for exactly what was proven.

## The most important architectural decision: the webhook is authoritative, never the browser redirect

Stripe Checkout redirects the browser back to `success_url` the instant a customer finishes paying on Stripe's hosted page — but that redirect is just the browser following a link; it is not proof a payment actually completed, and it's not even guaranteed to happen at all (the user can close the tab, lose connectivity, or the redirect can race a slow webhook). The only thing this system ever treats as "payment succeeded" is a Stripe **webhook** event (`checkout.session.completed`) whose signature has been cryptographically verified server-side. The confirmation page never renders a "Booking confirmed!" state just because `?session_id=` is present in the URL — it queries the booking's actual server-side `status` column, which only a verified webhook (or its `reconcilePendingBooking` fallback, itself gated by a real Stripe API call, not the URL) can ever set to `confirmed`.

This has to tolerate, by design, not by luck:
- the webhook arriving **before** the redirect (the common case — Stripe's webhook delivery is usually faster than a human clicking through the browser),
- the redirect arriving **before** the webhook (`reconcilePendingBooking` handles this — see below),
- the webhook being delivered **twice** (idempotency — see below),
- the user closing the browser mid-checkout or after paying but before the redirect completes (the booking is still confirmed by the webhook regardless; the row exists and My Bookings shows it correctly on the next visit),
- payment cancellation or failure on Stripe's own page (Stripe redirects to `cancel_url` — the booking stays `pending`, never `confirmed`, and is treated the same as any other abandoned pending booking — see "Known limitation" below).

## Hosted Stripe Checkout — redirect-only, no client-side Stripe.js

`lib/services/payments.ts#createCheckoutSession()` calls `stripe.checkout.sessions.create()` server-side and returns `session.url` — a Stripe-hosted payment page. The browser's only job is `window.location.href = url` (in `BookingWidget.tsx`); there is no `@stripe/stripe-js`, no `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and no client-side Stripe SDK anywhere in this codebase. This is the minimal-footprint choice for a webhook-authoritative flow — nothing about payment state ever needs to run in the browser.

Two env vars, both server-only, neither ever exposed as `NEXT_PUBLIC_*` (see `.env.example`):
- **`STRIPE_SECRET_KEY`** — creates Checkout Sessions and retrieves session state.
- **`STRIPE_WEBHOOK_SECRET`** — verifies the webhook's signature.

`getStripeClient()` constructs the Stripe SDK client lazily on first real use (memoized after that), never at module load — the same posture `getSupabaseEnv()` established in Phase 2, so pages that never touch checkout still build and run with no Stripe env vars configured at all.

## Payment ordering: the booking is created *before* Stripe is ever contacted

`lib/actions/checkout.ts#createCheckoutSessionAction()`:

1. `createBooking(..., status: "pending")` — the **same** `createBooking()` from Phase 4A, now accepting an optional `status` field (default `"confirmed"`, so every Phase 4A caller's behavior is byte-for-byte unchanged). This is where the exclusion constraint gets its chance to reject an unavailable slot — before any payment intent exists, before Stripe has been contacted at all.
2. If step 1 fails (`slot_unavailable`, `concurrent_conflict`, or any other `BookingError`), the action returns immediately. **Zero Stripe calls happen for a slot the database refused.**
3. `createCheckoutSession()` — a real Stripe Checkout Session, charging exactly `booking.price_amount`/`booking.currency` (the row's own stored snapshot from step 1, never anything the client sent to this action).
4. If step 3 fails (Stripe API error, or a session that comes back with no `url`), the pending booking created in step 1 is cancelled via the existing `cancelBooking()` — a fresh pending booking always passes its "hasn't started yet" eligibility check, so no special-casing was needed there. The user is never left holding an unpayable pending reservation because of a Stripe-side failure.
5. `attachCheckoutSession()` records `stripe_checkout_session_id` on the booking (an ordinary self-service update — see RLS note below) and the action returns the redirect URL.

If step 5 itself fails after a real session was already created, the same cancel-the-pending-booking cleanup in step 4 runs — the booking is never left pending with an orphaned session id it can never be paid against.

## Webhook: signature verification, one authoritative event, idempotent by construction

`src/app/api/stripe/webhook/route.ts`:

- **Raw body, not parsed JSON.** `request.text()` — never `request.json()` — because Stripe's signature is computed over the exact bytes sent; parsing and re-serializing would produce a different byte sequence and every signature would fail.
- **`checkout.session.completed` is the only event this endpoint acts on** — Stripe's own recommended top-level "a Checkout finished" signal, and the one that carries `metadata.booking_id` (set at session-creation time), so confirming a payment never needs a second lookup to figure out which booking it's for. Every other event type Stripe might send to this endpoint is acknowledged with `200` and ignored — Stripe retries on anything other than a 2xx response, so an endpoint that only cares about one event type still has to ack the rest or it'll be re-delivered forever.
- **A malformed session** (missing `booking_id`, `payment_intent`, or `amount_total`) is also acknowledged with `200` rather than retried — retrying can't fix a session that was never created with the right shape.
- **Idempotency is a property of the state transition, not a separate "processed events" table.** `confirmBookingPayment()` (`lib/services/bookings.ts`) calls the `confirm_booking_payment()` Postgres RPC, whose `UPDATE ... WHERE status = 'pending'` only ever matches a booking that's still pending. A duplicate delivery of the same event finds the booking already `confirmed`, the `UPDATE` matches zero rows, the RPC returns `false`, and the handler still returns `200` — a safe no-op, not an error. No event-id bookkeeping table exists or is needed for this to be correct.
- **The confirmed amount/currency are Stripe's own**, read from the completed session (`session.amount_total`, `session.currency`) — not re-derived from the booking row a second time. The RPC itself is what checks those against the booking's stored `price_amount`/`currency` before it will transition anything (see below) — a mismatch is a silent no-op, not a confirmed booking at the wrong price.

## `confirm_booking_payment()`: a `SECURITY DEFINER` RPC instead of a service-role key

The brief explicitly permits using `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` for webhook reconciliation, since a webhook request has no user session to act as. This implementation deliberately doesn't reach for that — it never enters the application runtime at all in this codebase, same as every phase before it (see [RLS strategy](#rls-strategy)). Instead, `confirm_booking_payment(booking_id, stripe_checkout_session_id, stripe_payment_intent_id, expected_amount, expected_currency)` is a `SECURITY DEFINER` Postgres function — the exact same pattern as `is_admin()` and `get_available_slots()` from earlier phases — callable with the plain anon key:

```sql
create or replace function public.confirm_booking_payment(
  p_booking_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
  p_expected_amount integer,
  p_expected_currency text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  update public.bookings
  set status = 'confirmed',
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      paid_at = now()
  where id = p_booking_id
    and status = 'pending'
    and stripe_checkout_session_id = p_stripe_checkout_session_id
    and price_amount = p_expected_amount
    and currency = p_expected_currency
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;
```

It only ever transitions a booking whose stored `stripe_checkout_session_id`, `price_amount`, and `currency` all match what's passed in — so even if this RPC's name were somehow discovered and called directly by an attacker with the anon key, they would need to already know a specific booking's id *and* its real, Stripe-generated, effectively unguessable session id, and even then could only prematurely confirm a booking already headed toward confirmation — never change its price, never create a new one, never confirm an arbitrary booking without knowing its exact session id first. This keeps a broad, catastrophic-if-leaked credential out of the app runtime for a narrow, self-limiting one instead.

**The `set_config('air_rally.bypass_booking_tampering', 'true', true)` bypass, explained:** the Phase 4A `bookings_prevent_tampering` `BEFORE UPDATE` trigger silently reverts `status`/price/time changes for anything that isn't a self-service `pending|confirmed → cancelled` transition — which would otherwise block this RPC's own `pending → confirmed` update, since the webhook has no authenticated user session to satisfy an "am I an admin" check even if one existed. `set_config(..., true)` (the third argument, `is_local`) scopes the flag to the **current transaction only** — it can never leak into a different request, a different connection, or a later transaction on the same connection. The trigger checks for this flag and, only when it's set, additionally permits `stripe_payment_intent_id`/`paid_at` to be written — a narrow, transaction-scoped exception for the one function that's allowed to make this specific transition, not a weakening of the trigger for any other caller.

## Reconciliation: the "redirect arrives before the webhook" fallback

`reconcilePendingBooking()` (`lib/services/bookings.ts`) is called from the confirmation page (`src/app/(marketing)/bookings/[bookingId]/confirmation/page.tsx`) whenever it loads and finds a booking that's still `pending` with a `?session_id=` present in the URL. It fetches the Checkout Session directly from Stripe's own API (`retrieveCheckoutSession()` — a real network call, not a cache or a trust-the-URL shortcut) and, only if Stripe itself reports `payment_status === "paid"`, runs the **exact same** `confirmBookingPayment()`/RPC path the webhook uses. Whichever path — webhook or this fallback — gets there first makes the transition; the other one finds the booking already confirmed and safely no-ops, via the identical idempotency guard described above. There is no second, weaker confirmation mechanism anywhere in this codebase.

## Booking state model: `pending` / `confirmed` / `cancelled`, unchanged from Phase 4A

No new statuses were added. `pending` — anticipated but unused in Phase 4A — now has its real meaning: a reserved slot awaiting payment. The one behavioral difference from Phase 4A: `createBooking()`'s `status` input defaults to `"confirmed"` for every existing caller, and only the checkout action passes `"pending"` — nothing that worked before this phase changed behavior.

## Price integrity

Every dollar amount Stripe ever charges traces back to exactly one place: the `price_amount`/`currency` columns on the pending booking row, computed server-side at booking-creation time from the court's *current* `hourly_price` (unchanged Phase 4A logic — see "Price snapshot and money representation" above). `createCheckoutSession()`'s Stripe line item uses `booking.price_amount`/`booking.currency` directly; nothing about price is ever accepted from the client at the checkout-action layer, and the webhook's `confirm_booking_payment()` RPC independently re-checks Stripe's own reported `amount_total`/`currency` against that same stored snapshot before it will confirm anything.

## Cancellation and refunds: unchanged mechanism, an honest gap

`CancelBookingButton` (new) calls the existing, unchanged `cancelBookingAction` from Phase 4A — no new cancellation logic, no direct client-side status mutation, no invented refund flow. **No refund is issued automatically when a paid booking is cancelled** — this system has no Stripe refund integration at all. The cancellation confirmation dialog says so explicitly ("Refunds aren't handled automatically yet — contact the venue directly if you paid and need one.") rather than implying one happens. This is a real, documented limitation, not an oversight — refunds were explicitly out of scope for this phase.

## Known limitation: abandoned pending bookings

If a user creates a pending booking, is redirected to Stripe, and then simply never completes or cancels checkout (closes the tab, walks away), that booking stays `pending` forever — there's no scheduled job that expires it, and no `expired` status exists (see Phase 4A's "Booking statuses" section for why that status was deliberately deferred). Two consequences worth being explicit about:

1. **The slot stays reserved.** The `bookings_no_overlap` exclusion constraint treats `pending` the same as `confirmed` (`where status in ('pending', 'confirmed')`) — so an abandoned pending booking genuinely blocks that court/time for anyone else, indefinitely, until someone (the original user, from My Bookings) cancels it.
2. **My Bookings surfaces this honestly** rather than hiding it: a `pending` booking shows a "Payment pending" badge and remains cancellable (before its start time), the same as any other booking — there's no special "abandoned" detection, just the same real state shown truthfully.

A real fix (a scheduled job releasing pending bookings past some TTL, and the `expired` status that would need) is real, anticipated future work — not built here because no scheduled-task infrastructure exists in this project yet, the same reasoning Phase 4A gave for not building `completed`/`expired` in the first place.

## Timezone display: formatting, not arithmetic

`BookingWidget.tsx` and the confirmation/My-Bookings pages format already-correct UTC instants (`booking.start_time`/`end_time`, both `timestamptz`) into the venue's local wall time for display, using `Intl.DateTimeFormat` with an explicit `timeZone: venue.timezone` option — never a second implementation of DST-aware arithmetic in JavaScript. All the actual timezone *arithmetic* (deciding which UTC instants a given local date's slots fall on) still happens exactly where Phase 4A put it: inside the `get_available_slots`/`is_court_time_bookable` Postgres functions, via `AT TIME ZONE`. No new timezone library was added — `date-fns` (already a dependency) supplies date-pill helpers (`addDays`, `isToday`, `isTomorrow`) that don't need timezone awareness themselves, since the 14 date pills the widget shows are just "today + N days," computed once client-side for display and re-validated server-side by the same `MAX_BOOKING_WINDOW_DAYS`/`MIN_LEAD_TIME_MINUTES` checks `createBooking()` already enforces.

## Availability UI: client-driven requests, server-computed answers

`BookingWidget.tsx` (replacing `CourtsPricingPanel` on Court Details) calls `getAvailableSlotsAction()` — unauthenticated, since availability is public marketplace information, matching the visibility of the venue/court pages themselves — which is a thin wrapper around Phase 4A's unchanged `get_available_slots()` RPC. Duration options are generated from `lib/booking-config.ts`'s existing constants, never re-declared. The widget's data-fetching effect derives its loading state from a `requestKey`/`resolvedKey` comparison pair (bumped by a `refreshNonce` state set only inside event handlers, never synchronously inside the effect body) rather than imperative `setLoadingSlots(true)` calls at the top of the effect — the same fix pattern this project's React Compiler lint rule (`react-hooks/set-state-in-effect`) already forced in Phase 3's `FilterBar`/`MarketplaceSearchInput`.

## RLS: no new policies, one trigger extension

The three existing `bookings` RLS policies (select/insert/update, from Phase 4A) already cover the three new columns (`stripe_checkout_session_id`, `stripe_payment_intent_id`, `paid_at`) for free — RLS is row-level, not column-level, so a new column needs no new policy. The one real change is to the existing `bookings_prevent_tampering` trigger: it now also silently reverts `stripe_payment_intent_id`/`paid_at` for any non-admin update outside the `confirm_booking_payment()` bypass described above. `stripe_checkout_session_id` is deliberately **not** guarded by that trigger — it's low-stakes metadata the booking's own owner legitimately sets once, pre-payment, via `attachCheckoutSession()`'s ordinary self-service update.

The confirmation page adds one authorization check *stricter* than what RLS alone would permit: RLS lets a venue owner see bookings at their own courts (a deliberate Phase 4A allowance, for a future owner dashboard), but the confirmation page is specifically "here's your own payment receipt" — it explicitly checks `booking.user_id !== user.id` and 404s otherwise, rather than relying on RLS's broader visibility.

## Two additive migrations (written, reviewed, applied to the live project)

**`20260810000006_venue_marketplace_timezone.sql`** — `CREATE OR REPLACE VIEW public.venue_marketplace`, reproducing Phase 3's exact column list with `v.timezone` appended at the end (Postgres requires a replaced view's existing column list/order to stay intact — a new column can only be appended). Needed because the booking widget has to know a venue's IANA timezone to interpret/display slots correctly, and the marketplace view — the only thing player-facing pages are allowed to read from — didn't select it.
- *RLS impact:* none. Views inherit their access posture from the underlying tables' RLS (via `security_invoker = true`, already set) plus the view's own `where status = 'active'` filter (already there, unchanged) — adding a selected column changes what a permitted read returns, not who's permitted to read. `timezone` is no more sensitive than `city`, already public.
- *Idempotency impact:* none — doesn't touch `bookings` or any payment-related state.
- *Verified live:* a direct read-only REST query against the live `venue_marketplace` view returned `timezone: "Asia/Manila"` for a real venue row after applying this migration.

**`20260810000007_booking_payments.sql`** — three new nullable columns on `bookings` (`stripe_checkout_session_id text unique`, `stripe_payment_intent_id text`, `paid_at timestamptz`), the `bookings_prevent_tampering` trigger extension described above, and the `confirm_booking_payment()` function.
- *RLS impact:* none on the policies themselves — see "RLS" above.
- *Idempotency impact:* this migration **is** the idempotency mechanism (see "Webhook" above) — without these columns there'd be nowhere to record what a webhook has already confirmed, and without the RPC's `where status = 'pending'` guard, a duplicate delivery could re-run confirmation logic against an already-confirmed row.
- *Verified live:* a read-only query selecting the three new columns from the live `bookings` table returned `200` (not a schema error), and a direct call to `confirm_booking_payment()` with a bogus booking id executed successfully and correctly returned `false` (safe no-op for a non-existent booking) — both confirming the migration's actual, current live-schema state, not just a "Success" message from the SQL Editor.

Neither migration touches `bookings_no_overlap` in any way.

## Testing: mocked Jest (code correctness) vs. live Stripe TEST MODE (real behavior) — kept explicitly distinct

**Mocked Jest** (part of the normal `npm test` run, alongside every earlier phase's tests): `src/lib/services/__tests__/payments.test.ts` (Checkout Session creation charges exactly the booking's stored price/currency, metadata is exactly `booking_id`/`user_id`, Stripe failures wrap into a typed `PaymentError` rather than leaking, signature verification delegates to `stripe.webhooks.constructEvent`), extended `bookings.test.ts` (`getBookingById`, `attachCheckoutSession`, `confirmBookingPayment`'s exact RPC argument mapping, and every `reconcilePendingBooking` branch — not-found, already-confirmed, session-id mismatch, unpaid session, and the full paid-and-confirmed path), `src/lib/actions/__tests__/checkout.test.ts` (the booking-before-Stripe ordering verified via `mock.invocationCallOrder`, zero Stripe calls on an unavailable slot or a `23P01` race, the pending booking is cancelled if Stripe session creation *or* `attachCheckoutSession` fails, unauthenticated access rejected), `src/lib/actions/__tests__/availability.test.ts` (no auth required, parsed values passed straight through), and `src/app/api/stripe/webhook/__tests__/route.test.ts` (missing/invalid signature → `400` without ever calling `confirmBookingPayment`, non-`checkout.session.completed` events acknowledged and ignored, a malformed session acknowledged rather than retried forever, a valid completed session confirms with Stripe's own amount/currency/ids, and — the idempotency proof — a second delivery of the identical event still returns `200` even though `confirmBookingPayment` reports `false`). This proves the *code's logic* is correct for every input; it does not, by itself, prove Stripe's real API, real signatures, or real webhook delivery behave as assumed — that's what the live pass below is for.

**Live Stripe TEST MODE** (manual, documented, explicitly not part of `npm test`/CI — the same two-tier posture Phase 4A established for the concurrency proof) — **run and passed**. `scripts/verify-stripe-webhook-flow.ts` (two-step: `create` then `confirm`, since a human has to complete the actual payment on Stripe's hosted page in between — no Stripe CLI or tunnel exists in this environment to receive a real webhook delivery at `localhost`):

1. Signed in as a real test user, found a real available slot via `get_available_slots`, created a real **pending** booking (₱500.00 for a 60-minute slot), and created a real Stripe test-mode Checkout Session for it against Stripe's actual API.
2. The Checkout Session's real `stripe.com` hosted page was opened and paid with Stripe's official test card (`4242 4242 4242 4242`) — the page showed the correct venue/court description and the correct ₱500.00 amount before payment, a green success state after, and genuinely redirected to the configured `success_url` afterward (not simulated).
3. The now-completed session was re-fetched from Stripe's real API (`payment_status: "paid"`), and its real data (`payment_intent`, `amount_total`, `currency`) was assembled into a `checkout.session.completed` event payload, signed with the real `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.generateTestHeaderString` — a genuine Stripe signature, not a fabricated one.
4. That signed payload was POSTed to the actual, unmodified `src/app/api/stripe/webhook/route.ts` running on a real local dev server. **First delivery:** `200 { received: true, confirmed: true }` — the dev server's own logs confirm the real route handler ran (`POST /api/stripe/webhook 200`), and a re-fetch of the booking showed `status: "confirmed"`, a real `stripe_payment_intent_id` (`pi_3U2d1V...`), and a real `paid_at` timestamp.
5. The **identical** signed payload was POSTed a second time to prove idempotency: `200 { received: true, confirmed: false }` — the server's own log shows the documented `stripe.webhook.confirmNoOp` line firing exactly as designed (not an error condition), and the booking's `status`/`paid_at` were unchanged from the first delivery — a genuine duplicate-delivery no-op against the live database, not a mock.
6. The test booking was cancelled afterward as cleanup (bookings have no delete policy, by design — "cancelled" is the correct, honest end state, same convention `verify-no-double-booking.ts` established in Phase 4A).

This is weaker than true end-to-end webhook delivery (Stripe's own infrastructure never actually reached this endpoint — the signed payload was relayed locally instead), and is reported as such rather than implied to be equivalent to production behavior. What it does prove, against real Stripe data and the real live database: the webhook route's signature verification, its `checkout.session.completed` handling, its price/currency/session-id matching inside `confirm_booking_payment()`, and its idempotency guarantee all behave exactly as designed.

---

# Phase 5 (in progress): Review submission

The `reviews` table, its RLS policies, and the `update_venue_rating_stats()` rating-aggregate trigger all existed since Phase 2 but were unused — Phase 3's read path (`listReviewsByVenue`) had nothing to display until a real booking could exist to attach a review to. Phase 4A/4B's `bookings.status` now supplies exactly that.

## Eligibility model

A user is eligible to review a venue if they have at least one of their own `bookings` — at a court belonging to that venue — whose `status` is `confirmed` (the payment-verified state Phase 4B's webhook sets; there is deliberately no separate "was it paid" check to invent) and whose `end_time` has already passed. `lib/services/reviews.ts#getReviewEligibility()` computes this via two separate queries (the venue's courts, then the caller's own matching bookings) rather than a `courts!inner(...)` PostgREST embed — an embed would apply the joined `courts` row's own RLS to the join, which would silently drop a genuinely-eligible past booking from consideration if that specific court has since gone inactive, even though the booking itself is still perfectly valid. Same reasoning `createBooking()` already documents for its own courts/venues lookup in Phase 4A.

`createReview()` never trusts a client-supplied `bookingId` at face value — it re-derives eligibility server-side and rejects a mismatch, the same "client input shapes the request, live server data decides whether it's allowed" posture every write in this codebase already follows.

## No new migration

Everything needed — the table, RLS, the rating-aggregate trigger — already existed. This is the first Phase 5 item and the only one so far that needed zero schema changes.

## UI

A minimal review-submission form appears on Court Details only when the server page has already determined the signed-in viewer is eligible — an ineligible visitor sees no control at all, matching this codebase's established preference (e.g. `BookingWidget` for an unauthenticated visitor) for not showing a control a user categorically can't use rather than a disabled one with an explanation.

---

# PayMongo TEST MODE — Experimental Second Payment Provider

An experimental, switchable second payment provider behind the existing `lib/services/payments.ts` (Stripe) seam — not a replacement, not a redesign. Controlled by one env var, `ACTIVE_PAYMENT_PROVIDER` (`"stripe"` default, `"paymongo"` to opt in), read once in `lib/actions/checkout.ts`. No other file needs to know which provider is active — `BookingWidget.tsx` and every other component already just redirect to whatever URL the checkout action returns.

## Architecture: parallel, not shared

`lib/services/paymongo.ts` (Checkout Session creation/retrieval, real webhook signature verification), `src/app/api/paymongo/webhook/route.ts`, and the `confirm_paymongo_booking_payment()` Postgres RPC are structural twins of their Stripe equivalents — deliberately duplicated rather than generalized into a shared abstraction, so nothing about this experiment can ever change Stripe's already-live, already-verified behavior. `lib/services/payments.ts`, `src/app/api/stripe/webhook/route.ts`, and `confirm_booking_payment()` are untouched.

No PayMongo npm SDK is installed — `lib/services/paymongo.ts` calls `api.paymongo.com` directly via `fetch`, HTTP Basic auth with the secret key.

## Webhook signature verification — real, not guessed

PayMongo's `Paymongo-Signature` header: `t=<unix timestamp>,te=<test-mode HMAC>,li=<live-mode HMAC>`. The signed string is `${t}.${rawBody}`, HMAC-SHA256'd with the webhook secret, compared timing-safely. This implementation checks `te=` only — never `li=` — since it's TEST MODE only by design. Sourced from PayMongo's official `paymongo-node` SDK source, cross-referenced against a real header example, not invented.

## Database

One additive migration, `supabase/migrations/20260810000008_paymongo_provider.sql`: `bookings.payment_provider` (defaults `'stripe'`), `paymongo_checkout_session_id`, `paymongo_payment_intent_id`. Extends `prevent_booking_tampering()` to guard `paymongo_payment_intent_id` only — `payment_provider`/`paymongo_checkout_session_id` are deliberately left owner-writable once, pre-payment, same as `stripe_checkout_session_id` always has been. Applied to the live project and verified via read-only query.

## Live TEST MODE verification — passed

`scripts/verify-paymongo-checkout-flow.ts` (mirrors `verify-stripe-webhook-flow.ts`'s two-step shape) proved, against real PayMongo data: a real pending booking → a real Checkout Session → a real completed test-card payment (`pay_H1DVQQYbdaN8R887yhtgopAD`) → the real signature verified → `confirm_paymongo_booking_payment()` correctly transitioned the booking to `confirmed` → an identical duplicate delivery safely no-opped (proven idempotent) → My Bookings and the confirmation page rendered correctly. The Stripe path was independently re-verified immediately after (a real Stripe Checkout Session still creates correctly with the default/unset provider), confirming zero regression.

## What this is not

No Platforms/marketplace splitting, no Child Merchant onboarding, no 95%/5% commission logic, no customer processing fee, no production webhook registration. This integration only proves AIR/Rally can process a normal, unsplit booking payment through PayMongo TEST MODE without breaking Stripe — nothing more.
