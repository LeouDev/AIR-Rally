# Design System

## Brand

- **Name:** Air/Rally — the slash is intentional and appears in the wordmark (`AIR` in navy, `/Rally` in orange).
- **Primary tagline:** Play More. Rally More.
- **Supporting phrase:** Find your court. Find your game.
- **Mark:** a paddle-and-ball motif inside a rounded triangular frame. Source files are in [`brand-source/`](./brand-source); derived, optimized assets used by the app live in `public/brand/` (`mark-transparent.png`, `og-image.png`) and `src/app/` (`icon.png`, `apple-icon.png`, `favicon.ico`).

The color palette and tagline below come directly from the existing Air/Rally brand assets (logo, social template) rather than being invented from scratch — the project brief's generic "Deep Forest Green" placeholder guidance was superseded by the real, already-designed identity: navy + orange, not green.

## Color tokens

Defined once in `src/app/globals.css` as CSS custom properties, mapped into Tailwind's `@theme inline` block, and consumed everywhere through semantic utility classes (never hardcoded hex in components).

| Token | Light | Usage |
| --- | --- | --- |
| `background` | `#faf8f5` (warm off-white) | page background |
| `foreground` | `#12151a` (near black) | body text |
| `primary` | `#f3700f` (Rally Orange) | primary actions — "Find a Court", "Book Court", active states |
| `secondary` | `#0f2747` (Deep Navy) | nav/header surfaces, secondary CTA blocks |
| `muted` | `#f2efe9` | subdued surfaces, section backgrounds |
| `accent` | `#fdece0` (soft orange tint) | hover/highlighted surfaces |
| `success` | `#1a9c5b` | "open now", positive status |
| `warning` | `#d97a06` | caution states |
| `destructive` | `#dc2626` | errors, remove actions |
| `border` | `#e7e3da` | dividers, card borders |
| `card` | `#ffffff` | card surfaces |

A full dark-mode set exists alongside every light token (see `.dark` in `globals.css`) using the same relationships — navy becomes a card/surface tone, orange brightens slightly for contrast on dark backgrounds.

`--color-navy` / `--color-rally` are also exposed directly for the rare case a component wants the brand color itself rather than its semantic role (e.g. the wordmark's `/`).

## Typography

Geist Sans (via `next/font/google`) for everything — UI text and headings. It's a modern, highly readable geometric sans that reads as premium consumer tech without needing a second display typeface. Geist Mono is loaded but unused in Phase 1 (reserved for future data-dense views like an owner dashboard).

Hierarchy is expressed with Tailwind's type scale directly (`text-4xl`/`text-3xl` for display/H1, `text-2xl`/`text-xl` for H2/H3, `text-base`/`text-sm` for body/small) rather than custom named classes — one scale, no per-component font-size decisions.

## Spacing & shape

- Base radius `0.75rem`, scaled via `--radius-sm` through `--radius-3xl` for consistent rounding across buttons, cards, and inputs — rounded but not cartoonish.
- Generous section padding (`py-16`+ between marketing sections) and card padding (`p-4`–`p-6`) throughout; no cramped layouts.

## Components

Built on shadcn/ui (Radix primitives + Tailwind), extended with domain components:

- **Primitives** (`components/ui`): Button, Input, Badge, Card, Dialog, Sheet, Select, Tabs, Tooltip, Skeleton, Sonner (toast), etc. — generated via the shadcn CLI, themed through the tokens above.
- **Court domain** (`components/court`): `CourtCard`, `CourtSurface` (illustrated aerial court view — see ARCHITECTURE.md), `Rating`, `FavoriteButton`, `AmenityList`, `ImageGallery`, `AvailabilitySelector`, `ReviewPreview`, `BookingPanel`.
- **Search** (`components/search`): `SearchBar`, `FilterBar`, `MapPlaceholder`.
- **Layout** (`components/layout`): `Navbar`, `MobileNav`, `Footer`, `AppShell`, `Logo`.
- **Shared** (`components/shared`): `SectionHeader`, `EmptyState`, `LoadingSkeleton` (`CourtCardSkeleton`, `CourtGridSkeleton`, `CourtDetailSkeleton`).

## States

Every data-driven view has an explicit state, not just a happy path:

- **Loading:** `CourtGridSkeleton` / `CourtDetailSkeleton` for skeleton placeholders.
- **Empty:** `EmptyState` — used for no bookings, no favorites, signed-out profile, no search results.
- **Error/edge:** disabled/struck-through unavailable time slots, "no courts match your filters" with a reset action.
- **Success:** toasts (via Sonner) confirm actions that don't yet have a backend (booking attempt, form submits).

## Motion

Framer Motion is used sparingly and only where it clarifies an interaction: the favorite heart's tap scale, and card hover lift/scale on `CourtCard`. Page-level transitions and anything decorative were deliberately left out — per the brief, "the experience should feel fast," not busy.

## Accessibility

- All interactive icons (favorite, close buttons, etc.) carry an accessible name via `aria-label`, not just a visual icon.
- Selection state is expressed with `aria-pressed`/`aria-selected` (favorite button, time slots, image gallery tabs), not color alone.
- Focus states use a consistent `focus-visible:ring-2 focus-visible:ring-ring/50` across custom interactive elements, on top of shadcn's built-in focus handling.
- Form errors are associated with their fields and rendered in `destructive` red with sufficient contrast against the off-white background.
