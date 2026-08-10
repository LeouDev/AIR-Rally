/**
 * Single source of truth for every booking business rule with a "why not a
 * different number" decision behind it. Every validator — the service
 * layer today, any future UI — imports from here rather than re-declaring
 * these values, per the Phase 4A brief's explicit instruction not to
 * scatter them across the codebase.
 */

/** Bookable start times fall on this many minutes past the hour/half-hour — matches the brief's own worked examples (7:00–7:30 valid, 7:15–8:15 invalid). */
export const SLOT_INCREMENT_MINUTES = 30;

export const MIN_DURATION_MINUTES = 30;
export const MAX_DURATION_MINUTES = 240;

/** Matches the brief's own example. No product policy exists beyond it yet — documented as a default, not a researched business rule. */
export const MIN_LEAD_TIME_MINUTES = 30;

/** How far into the future a booking may be made. A single global default for Phase 4A — no per-venue override exists yet. */
export const MAX_BOOKING_WINDOW_DAYS = 30;

/** Matches every current venue/court in the database — all Philippines-based. */
export const DEFAULT_CURRENCY = "PHP";
