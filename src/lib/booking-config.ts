/**
 * Single source of truth for every booking business rule with a "why not a
 * different number" decision behind it. Every validator — the service
 * layer today, any future UI — imports from here rather than re-declaring
 * these values, per the Phase 4A brief's explicit instruction not to
 * scatter them across the codebase.
 */

/**
 * Bookable start times fall on the hour. Half-hour starts were dropped in
 * favour of whole-hour slots only — courts are sold by the hour, and a
 * 30-minute grid produced starts (7:30, 8:30) that no venue actually
 * offered. Changing this reshapes both the availability grid and the
 * duration options below, since a duration must be a whole multiple of it.
 */
export const SLOT_INCREMENT_MINUTES = 60;

/** One hour is the shortest bookable session. */
export const MIN_DURATION_MINUTES = 60;
export const MAX_DURATION_MINUTES = 240;

/** Matches the brief's own example. No product policy exists beyond it yet — documented as a default, not a researched business rule. */
export const MIN_LEAD_TIME_MINUTES = 30;

/** How far into the future a booking may be made. A single global default for Phase 4A — no per-venue override exists yet. */
export const MAX_BOOKING_WINDOW_DAYS = 30;

/** Matches every current venue/court in the database — all Philippines-based. */
export const DEFAULT_CURRENCY = "PHP";

/**
 * AIR/Rally's marketplace commission — 5% of the original gross booking
 * price, confirmed with PayMongo (see ARCHITECTURE.md's PayMongo
 * Platforms section). Computed once, server-side, from price_amount —
 * never from a post-processing-fee amount. Integer minor units only, see
 * lib/services/commission.ts.
 */
export const PLATFORM_FEE_PERCENT = 0.05;

/**
 * PayMongo's QR Ph merchant discount rate, VAT-inclusive — the cost of
 * collecting the money, passed on to the customer rather than absorbed.
 *
 * 1.50%, MEASURED — not derived. PayMongo publishes 1.34% for QR Ph and
 * states rates exclude VAT, which computes to 1.5008%; but an observed
 * live checkout with pass_on_fees on charged ₱406.09 against a ₱400
 * court, and 400 / (1 - 0.015) = 406.0914 -> ₱406.09 reproduces that
 * exactly, while 1.5008% gives ₱406.10. The published figure and the
 * charged figure disagree by a centavo, and this constant follows what
 * PayMongo actually charges.
 *
 * That centavo is not cosmetic. confirm_paymongo_booking_payment()
 * compares the amount paid against what we stored; predicting ₱6.10 when
 * PayMongo charges ₱6.09 means zero rows match and the booking never
 * confirms. This constant and PayMongo's own arithmetic must agree
 * exactly, which is the known fragility of this approach: if PayMongo
 * ever changes rate or rounding, confirmations stop and nothing in this
 * repo will have changed to explain why. Re-verify against a real
 * checkout if confirmations start failing.
 *
 * QR Ph is the only method enabled. GCash (2.23%) and cards (3.125% plus
 * a fixed peso amount) would each need their own rate — enabling one
 * without making this per-method will under-collect on it.
 */
export const PROCESSING_FEE_PERCENT = 0.015;

/**
 * V1 rescheduling business rule (locked): a confirmed booking may only be
 * rescheduled while its start_time is at least this many hours away. See
 * lib/services/reschedules.ts.
 */
export const RESCHEDULE_CUTOFF_HOURS = 24;

/**
 * AIR/Rally cancellation-credit policy (see lib/services/credits.ts).
 *
 * A customer who cancels at least this far ahead is eligible for
 * compensation in AIR/Rally Credits; inside the window they are not.
 * Anything the customer did not cause — a venue cancelling, a venue
 * becoming unavailable, or a system/payment error — is compensated in
 * full regardless of how close to the start time it happens, because the
 * customer bears no responsibility for it.
 */
export const CANCELLATION_CREDIT_CUTOFF_HOURS = 48;
