import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingStatus } from "@/lib/supabase/types";
import {
  SLOT_INCREMENT_MINUTES,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_LEAD_TIME_MINUTES,
  MAX_BOOKING_WINDOW_DAYS,
  DEFAULT_CURRENCY,
  PAYMONGO_PAYMENT_IN_FLIGHT_WINDOW_MINUTES,
} from "@/lib/booking-config";
import { retrievePayMongoCheckoutSession } from "@/lib/services/paymongo";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { resolveCancellationCredit, addCredit, type CancellationCause, type CancellationCreditDecision } from "@/lib/services/credits";
import { calculateRefundCredit } from "@/lib/services/bookingFee";
import { logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

/** Reused across calls, same lazy pattern credits.ts and reschedules.ts use. */
let bookingsServiceRoleClient: ReturnType<typeof createServiceRoleClient> | undefined;
function getBookingsServiceRoleClient() {
  bookingsServiceRoleClient ??= createServiceRoleClient();
  return bookingsServiceRoleClient;
}

/** Postgres error code for an exclusion-constraint violation — the actual, database-level double-booking guarantee (bookings_no_overlap). */
const POSTGRES_EXCLUSION_VIOLATION = "23P01";
/** Postgres error code for a malformed UUID literal (e.g. a garbage URL param) — same pattern as lib/services/venues.ts#getVenueDetail. */
const POSTGRES_INVALID_TEXT_REPRESENTATION = "22P02";

export type BookingErrorReason =
  | "court_not_found"
  | "venue_inactive"
  | "court_inactive"
  | "invalid_time_range"
  | "invalid_duration"
  | "past_time"
  | "lead_time_not_met"
  | "booking_window_exceeded"
  | "slot_unavailable"
  | "concurrent_conflict"
  | "booking_not_found"
  | "unauthorized_cancellation"
  | "already_cancelled"
  | "cancellation_window_passed"
  /**
   * A CONFIRMED booking that used AIR/Rally Credits cannot be cancelled —
   * credit spent on a secured court is final. See cancelBooking().
   */
  | "credit_booking_not_cancellable"
  /** A fully credit-covered booking could not be confirmed — see lib/actions/checkout.ts. */
  | "credit_confirmation_failed"
  /**
   * The passed-on PayMongo fee could not be recorded on the booking, so
   * checkout was abandoned rather than charging a total the webhook's
   * amount check would reject — see lib/actions/checkout.ts.
   */
  | "processing_fee_not_recorded"
  /**
   * The marketplace split snapshot could not be recorded, so checkout was
   * abandoned rather than routing a real split at PayMongo with no local
   * record of where the money went — see lib/actions/checkout.ts.
   */
  | "marketplace_split_not_recorded";

/**
 * Typed domain error for every booking-creation/cancellation failure mode
 * — never a raw Postgres/PostgREST error reaching the action layer for
 * these known cases. `message` is already user-safe; callers can show it
 * directly. See ARCHITECTURE.md's Phase 4A section for what each reason
 * means and which checks produce it.
 */
export class BookingError extends Error {
  constructor(
    public reason: BookingErrorReason,
    message: string
  ) {
    super(message);
    this.name = "BookingError";
  }
}

/**
 * A cancellation and what it decided about the customer's money.
 *
 * The decision is RETURNED rather than left for the UI to recompute: a
 * customer who cancels and is told nothing about their payment reads it as
 * "they kept my money", and a second implementation of the policy in a
 * component is how the two drift apart.
 */
export type CancelBookingResult = {
  booking: Booking;
  credit: CancellationCreditDecision & { issued: boolean };
};

export type CreateBookingInput = {
  courtId: string;
  startTime: string;
  endTime: string;
  /**
   * bookings_force_pending_on_insert (20260810000081) forces every new
   * booking's status to 'pending' at the database level regardless of what's
   * sent here — no caller has ever legitimately needed anything else at
   * insert time, and confirmation only ever happens afterward via
   * confirm_booking_payment() once payment is webhook-verified. Kept as a
   * field so a caller can still see what it accepts, but nothing this app
   * sends changes the row's actual status anymore.
   */
  status?: Extract<BookingStatus, "pending" | "confirmed">;
};

function getLocalMinuteOfHour(date: Date, timeZone: string): number {
  const minute = new Intl.DateTimeFormat("en-US", { timeZone, minute: "numeric" }).format(date);
  return Number(minute);
}

/**
 * Creates a real, database-guaranteed booking.
 *
 * Ordering matters and mirrors the Phase 4A brief's own numbered steps:
 * cheap, DB-independent checks first (time range, duration shape, lead
 * time, booking window — pure arithmetic, no query needed), then a single
 * DB round trip (court/venue lookup), then the availability pre-check,
 * then the insert itself.
 *
 * The availability pre-check (`is_court_time_bookable`) is explicitly NOT
 * the integrity guarantee — it's a UX nicety that lets a genuinely
 * unavailable request fail with a clear reason before ever reaching the
 * database. The actual guarantee is the `bookings_no_overlap` exclusion
 * constraint on the insert itself: even if this pre-check passes, a
 * concurrent request could still win the race, and the insert below is
 * what catches that — never assume the pre-check result still holds by
 * the time the insert runs.
 */
export async function createBooking(supabase: Client, userId: string, input: CreateBookingInput): Promise<Booking> {
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  const now = new Date();

  if (!(start.getTime() < end.getTime())) {
    throw new BookingError("invalid_time_range", "Start time must be before end time.");
  }

  const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes % SLOT_INCREMENT_MINUTES !== 0 ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw new BookingError(
      "invalid_duration",
      `Bookings must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes, in ${SLOT_INCREMENT_MINUTES}-minute increments.`
    );
  }

  if (start.getTime() < now.getTime()) {
    throw new BookingError("past_time", "That time has already passed.");
  }

  const leadTimeMs = MIN_LEAD_TIME_MINUTES * 60_000;
  if (start.getTime() < now.getTime() + leadTimeMs) {
    throw new BookingError("lead_time_not_met", `Bookings need at least ${MIN_LEAD_TIME_MINUTES} minutes' notice.`);
  }

  const windowMs = MAX_BOOKING_WINDOW_DAYS * 24 * 60 * 60_000;
  if (start.getTime() > now.getTime() + windowMs) {
    throw new BookingError("booking_window_exceeded", `Bookings can only be made up to ${MAX_BOOKING_WINDOW_DAYS} days in advance.`);
  }

  // Two separate, non-embedded queries rather than a single joined select.
  // A PostgREST embed (`courts.select("*, venues(...)")`) applies the
  // embedded table's own RLS to the join itself — for a normal player
  // that's fine (an inactive venue's row is invisible to them either way,
  // same as querying it directly), but it would silently collapse
  // "venue inactive" into "court not found" for a *venue owner* checking
  // their own not-yet-active court, since the owner-visibility branch of
  // courts' RLS doesn't require the venue embed to also match. Querying
  // venues separately, under the same caller's RLS, keeps that owner case
  // honest instead of RLS-order-dependent.
  const { data: court, error: courtError } = await supabase
    .from("courts")
    .select("id, status, hourly_price, venue_id")
    .eq("id", input.courtId)
    .maybeSingle();
  if (courtError) throw courtError;
  if (!court) {
    throw new BookingError("court_not_found", "We couldn't find that court, or it isn't currently available to book.");
  }
  if (court.status !== "active") {
    throw new BookingError("court_inactive", "This court isn't currently accepting bookings.");
  }

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("status, timezone")
    .eq("id", court.venue_id)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue || venue.status !== "active") {
    throw new BookingError("venue_inactive", "This venue isn't currently accepting bookings.");
  }

  // Start must land on the slot grid in the venue's own local time — the
  // brief's own example (7:15-8:15) has a valid *duration* but an invalid
  // *start offset*; duration-shape alone doesn't catch this.
  if (getLocalMinuteOfHour(start, venue.timezone) % SLOT_INCREMENT_MINUTES !== 0 || start.getSeconds() !== 0) {
    throw new BookingError(
      "invalid_duration",
      `Bookings must start on a ${SLOT_INCREMENT_MINUTES}-minute boundary.`
    );
  }

  const { data: bookable, error: bookableError } = await supabase.rpc("is_court_time_bookable", {
    p_court_id: input.courtId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_min_lead_minutes: MIN_LEAD_TIME_MINUTES,
    p_max_window_days: MAX_BOOKING_WINDOW_DAYS,
  });
  if (bookableError) throw bookableError;
  if (!bookable) {
    throw new BookingError(
      "slot_unavailable",
      "That time isn't available — it may be outside operating hours, blocked, or already booked."
    );
  }

  const priceAmount = Math.round(Number(court.hourly_price) * 100 * (durationMinutes / 60));

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      court_id: input.courtId,
      user_id: userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: input.status,
      price_amount: priceAmount,
      currency: DEFAULT_CURRENCY,
    })
    .select("*")
    .single();

  if (insertError) {
    // The actual integrity guarantee firing: a concurrent request won the
    // race between our pre-check and this insert. This is the expected,
    // correct way for that race to resolve — not a bug.
    if (insertError.code === POSTGRES_EXCLUSION_VIOLATION) {
      throw new BookingError("concurrent_conflict", "That time slot is no longer available.");
    }
    throw insertError;
  }

  return booking;
}

/**
 * Fetches a single booking by id under the caller's own RLS — returns
 * null for "doesn't exist", "not visible to this caller", AND a
 * malformed (non-UUID) id alike, the same "looks like nothing's there"
 * posture getVenueDetail() established in Phase 3 for exactly this class
 * of URL-param edge case. RLS itself already scopes this to the caller's
 * own bookings, bookings at courts they own, or an admin — callers that
 * need it narrowed further (e.g. "must be literally my own booking", not
 * just RLS-visible) should check `.user_id` themselves, same as the
 * confirmation page does.
 */
export async function getBookingById(supabase: Client, bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (error) {
    if (error.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw error;
  }
  return data;
}

/**
 * Cancellation policy for Phase 4A (no business policy exists yet beyond
 * this — documented as a conservative development default, not a
 * researched rule): a user may cancel their own booking any time before
 * it starts. `cancelled_at`/`cancelled_by` are computed by the
 * bookings_prevent_tampering database trigger, not sent by this function
 * — see supabase/migrations/20260810000004_bookings.sql.
 */
export async function cancelBooking(
  supabase: Client,
  userId: string,
  bookingId: string,
  options?: { cause?: CancellationCause }
): Promise<CancelBookingResult> {
  const existing = await getBookingById(supabase, bookingId);
  if (!existing) {
    throw new BookingError("booking_not_found", "We couldn't find that booking.");
  }
  if (existing.user_id !== userId) {
    throw new BookingError("unauthorized_cancellation", "You can only cancel your own bookings.");
  }
  if (existing.status === "cancelled") {
    throw new BookingError("already_cancelled", "This booking has already been cancelled.");
  }

  // Credit spent on a SECURED court is final: a confirmed booking that used
  // any AIR/Rally Credits cannot be cancelled and nothing is returned.
  //
  // Without this, credit is a perpetual motion machine. Credit is itself a
  // refund instrument, so a customer could cancel a paid booking for credit,
  // rebook with that credit, cancel again for credit, and hold the balance
  // forever while repeatedly taking and releasing real inventory.
  //
  // CONFIRMED ONLY, and that qualifier is load-bearing. A PENDING booking
  // must stay cancellable: lib/actions/checkout.ts cancels a just-created
  // pending booking whenever Checkout Session creation fails, and credit is
  // applied BEFORE that point. Refusing here would make the cleanup throw
  // and strand the customer's credit on a dead booking they can never use.
  // Migration 20260810000037 restores credit on exactly that path, which is
  // correct — nothing was consumed because the booking never happened.
  //
  // Any credit at all, not only fully-covered bookings: one rule is easier
  // to state to a customer than a threshold, and credit_amount_applied > 0
  // is the whole test.
  if (existing.status === "confirmed" && existing.credit_amount_applied > 0) {
    throw new BookingError(
      "credit_booking_not_cancellable",
      "Bookings paid with AIR/Rally Credits can't be cancelled, and the credits aren't returned."
    );
  }
  if (new Date(existing.start_time).getTime() <= Date.now()) {
    throw new BookingError("cancellation_window_passed", "This booking has already started and can no longer be cancelled.");
  }

  const { data: cancelled, error: updateError } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const credit = await compensateCancelledBooking(cancelled, options?.cause ?? "customer");
  return { booking: cancelled, credit };
}

/**
 * Issues cancellation compensation for a booking that was just cancelled,
 * and reports what was decided. SERVER ONLY.
 *
 * This is the wiring that was missing. resolveCancellationCredit() and
 * issueCancellationCredit() have existed and been tested since
 * 20260810000036, and NOTHING called them — cancelBooking() set the status
 * and stopped. Four paid bookings were cancelled on production well inside
 * policy and the credit ledger stayed empty, because there was no path.
 *
 * THE AMOUNT IS THE COURT PRICE, NOT WHAT WAS PAID.
 *
 * calculateRefundCredit() deliberately, and calculateAmountPaid() never.
 * A ₱406.09 booking compensates ₱400.00: the processing fee was consumed
 * by PayMongo at the moment of payment and AIR/Rally never held it.
 * calculateAmountPaid() is the RECEIPT figure and sits in the same module,
 * which is exactly why it is easy to reach for by mistake.
 *
 * NEVER THROWS. A failure to issue credit must not fail the cancellation:
 * the customer would be left unable to cancel at all, which is worse than
 * being owed credit that an admin can grant. Failures are logged loudly
 * and reported as issued:false, so the gap is visible rather than silent —
 * the same posture as the paid-but-unconfirmed alarm.
 */
async function compensateCancelledBooking(
  booking: Booking,
  cause: CancellationCause
): Promise<CancellationCreditDecision & { issued: boolean }> {
  // Nothing was taken, so there is nothing to give back. This is the
  // common case by volume: most cancelled bookings are abandoned
  // checkouts, and lib/actions/checkout.ts cancels a just-created pending
  // booking whenever session creation fails. Compensating those would mint
  // credit for money that never moved.
  if (!booking.paid_at) {
    return { amount: 0, eligible: false, reason: "This booking was never paid, so there is nothing to refund.", issued: false };
  }

  const decision = resolveCancellationCredit({
    // The REFUNDABLE base, not the amount paid — see the doc comment.
    amountPaid: calculateRefundCredit(booking),
    cause,
    startTime: booking.start_time,
    now: Date.now(),
  });

  if (!decision.eligible || decision.amount <= 0) {
    return { ...decision, issued: false };
  }

  try {
    // Idempotency at the ledger. cancelBooking() already refuses an
    // already-cancelled booking, so this should be unreachable — but credit
    // is money-like and the ledger is append-only, so a double-issue cannot
    // be undone, only offset. Two guards for something with no undo.
    const alreadyCompensated = await hasCancellationCompensation(booking.id);
    if (alreadyCompensated) {
      logServerError(
        "bookings.cancellationCredit.alreadyCompensated",
        new Error(`booking ${booking.confirmation_code} already has cancellation compensation; refusing to issue a second time`)
      );
      return { ...decision, issued: false };
    }

    await addCredit({
      userId: booking.user_id,
      amount: decision.amount,
      transactionType: "cancellation_compensation",
      referenceId: booking.id,
      description: `Credit issued for cancelled booking #${booking.confirmation_code}`,
    });
    return { ...decision, issued: true };
  } catch (error) {
    // The booking IS cancelled at this point. Saying so loudly beats
    // pretending it succeeded or unwinding a cancellation the customer
    // asked for.
    logServerError("bookings.cancellationCredit.issueFailed", error, { critical: true });
    return { ...decision, issued: false };
  }
}

/** Has this booking already been compensated? Service-role, because it reads another user's ledger rows. */
async function hasCancellationCompensation(bookingId: string): Promise<boolean> {
  const { data, error } = await getBookingsServiceRoleClient()
    .from("credit_transactions")
    .select("id")
    .eq("reference_id", bookingId)
    .eq("transaction_type", "cancellation_compensation")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** A user's own bookings, most recent first. */
export async function listMyBookings(supabase: Client, userId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("user_id", userId)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type BookingWithDetails = Booking & {
  courtName: string;
  courtIndoorOutdoor: string;
  venueName: string;
  venueCity: string | null;
  venueTimezone: string;
};

/**
 * Same as listMyBookings but joined to the court/venue names My Bookings
 * needs to actually display something. A booking made at a venue that's
 * since gone inactive won't resolve a name here (the embed goes through
 * courts'/venues' own RLS, which stops showing an inactive venue to a
 * non-owner) — a known, accepted limitation (see ARCHITECTURE.md), not
 * something worth a SECURITY DEFINER bypass for.
 */
export async function listMyBookingsWithDetails(supabase: Client, userId: string): Promise<BookingWithDetails[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, courts(name, indoor_outdoor, venues(name, city, timezone))")
    .eq("user_id", userId)
    .order("start_time", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const court = Array.isArray(row.courts) ? row.courts[0] : row.courts;
    const venue = court && (Array.isArray(court.venues) ? court.venues[0] : court.venues);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude it from `booking`
    const { courts: _courts, ...booking } = row;
    return {
      ...(booking as Booking),
      courtName: court?.name ?? "Court",
      courtIndoorOutdoor: court?.indoor_outdoor ?? "outdoor",
      venueName: venue?.name ?? "Venue",
      venueCity: venue?.city ?? null,
      venueTimezone: venue?.timezone ?? "Asia/Manila",
    };
  });
}

// --- PayMongo (the platform's only payment provider since 20260810000035) ---
//
// Deliberately parallel, not merged into the Stripe functions above: every
// function in this section is a structural twin of its Stripe equivalent,
// operating on the separate paymongo_* columns and the separate
// confirm_paymongo_booking_payment() RPC. This costs a little duplication
// in exchange for a hard guarantee that nothing here can ever change the
// behavior of the already-live, already-verified Stripe path above.

/**
 * Twin of attachCheckoutSession() — also records which provider this
 * booking is actually going through. Neither column it writes is guarded
 * by prevent_booking_tampering(), so the caller's own client is enough.
 *
 * The marketplace split snapshot deliberately does NOT travel with this
 * update; it goes through setBookingMarketplaceSplit() below, which must
 * be called BEFORE the checkout session exists. Passing it here is what
 * used to make it vanish silently.
 */
export async function attachPaymongoCheckoutSession(
  supabase: Client,
  bookingId: string,
  paymongoCheckoutSessionId: string
): Promise<void> {
  const { error } = await supabase
    .from("bookings")
    .update({
      payment_provider: "paymongo",
      paymongo_checkout_session_id: paymongoCheckoutSessionId,
    })
    .eq("id", bookingId);
  if (error) throw error;
}

/**
 * Records the audit snapshot of the marketplace split actually sent to
 * PayMongo's split_payment. SERVER ONLY.
 *
 * Goes through the service_role-only RPC rather than an ordinary update,
 * for exactly the reason setBookingProcessingFee() does — and this one was
 * a live latent bug rather than a precaution. platform_fee_amount /
 * venue_amount / paymongo_venue_account_id are all guarded by
 * prevent_booking_tampering(): 20260810000011 removed those three clauses
 * on purpose, and 20260810000038 silently copied them back while
 * re-declaring the function for an unrelated column. The guard reverts
 * instead of raising, so the previous update returned NO error and left
 * all three NULL — verified against staging as both the booking's owner
 * and service_role (scripts/verify-staging-marketplace-split-snapshot.ts).
 * The RPC sets the bypass GUC; see supabase/migrations/20260810000056.
 *
 * Returns false when the booking is no longer pending or the split exceeds
 * its price. Callers must treat that as a failed checkout: these figures
 * feed admin reconciliation and owner earnings reporting, so routing a
 * real split at PayMongo with no local record of it is not recoverable
 * after the fact.
 */
export async function setBookingMarketplaceSplit(
  bookingId: string,
  split: { platformFeeAmount: number; venueAmount: number; paymongoVenueAccountId: string }
): Promise<boolean> {
  if (!Number.isInteger(split.platformFeeAmount) || split.platformFeeAmount < 0) {
    throw new Error("Platform fee must be a non-negative whole number of centavos.");
  }
  if (!Number.isInteger(split.venueAmount) || split.venueAmount < 0) {
    throw new Error("Venue amount must be a non-negative whole number of centavos.");
  }
  if (!split.paymongoVenueAccountId.trim()) {
    throw new Error("A PayMongo venue account id is required to record a split.");
  }

  const { data, error } = await getBookingsServiceRoleClient().rpc("set_booking_marketplace_split", {
    p_booking_id: bookingId,
    p_platform_fee_amount: split.platformFeeAmount,
    p_venue_amount: split.venueAmount,
    p_paymongo_venue_account_id: split.paymongoVenueAccountId,
  });
  if (error) throw error;
  return data ?? false;
}

/**
 * Records what PayMongo will add to this booking's charge as its
 * processing fee. SERVER ONLY.
 *
 * Goes through the service_role-only RPC rather than an ordinary update,
 * and that is not optional. processing_fee_amount is guarded by
 * prevent_booking_tampering() — because confirm_paymongo_booking_payment()
 * trusts it — and that guard applies to service_role too: its escape hatch
 * is is_admin() or the bypass GUC, and is_admin() resolves auth.uid(),
 * which is null for a service-role call. A plain update here returns NO
 * error and silently leaves the column at 0 (verified against staging),
 * which would then fail the amount check on every booking. The RPC sets
 * the bypass GUC; see supabase/migrations/20260810000055.
 *
 * Returns false when the booking is no longer pending or the fee exceeds
 * its price — the caller must treat that as a failed checkout rather than
 * charging a customer against an amount the webhook won't accept.
 */
export async function setBookingProcessingFee(bookingId: string, amount: number): Promise<boolean> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("Processing fee must be a non-negative whole number of centavos.");
  }

  const { data, error } = await getBookingsServiceRoleClient().rpc("set_booking_processing_fee", {
    p_booking_id: bookingId,
    p_amount: amount,
  });
  if (error) throw error;
  return data ?? false;
}

/**
 * Why a verified-paid PayMongo payment did not confirm its booking.
 *
 * `amount_mismatch` is the only one that is an alarm. The others are
 * ordinary and expected, and conflating them is what made this failure
 * invisible: the webhook logged a single "confirmNoOp" line for all of
 * them, carrying no amounts, so a real mismatch was indistinguishable
 * from a duplicate webhook delivery.
 */
export type PaymentConfirmationDiagnosis =
  | { kind: "already_confirmed"; detail: string }
  | { kind: "reschedule_difference"; detail: string }
  | { kind: "amount_mismatch"; expected: number; actual: number; delta: number; detail: string }
  | { kind: "currency_mismatch"; detail: string }
  | { kind: "session_mismatch"; detail: string }
  | { kind: "booking_not_found"; detail: string }
  | { kind: "cancelled"; detail: string }
  | { kind: "unknown"; detail: string };

/**
 * Works out why confirm_paymongo_booking_payment() returned false for a
 * payment PayMongo reports as PAID. SERVER ONLY.
 *
 * WHY THIS EXISTS
 *
 * The amount check is strict equality by design — it is what stops a
 * browser session confirming a booking it never paid for (see migration
 * 20260810000047, verified exploitable on staging). It must never be
 * loosened into a tolerance band.
 *
 * But a strict check that fails SILENTLY is its own outage. Until now,
 * "PayMongo says paid" plus "our check refused" produced a still-pending
 * booking and, at best, an ambiguous log line. The customer sees a
 * pending screen having actually paid, and nobody finds out until someone
 * thinks to look.
 *
 * The concrete trigger is PROCESSING_FEE_PERCENT. It is 0.015, measured
 * against test-mode PayMongo fees, while PayMongo's published live QR Ph
 * rate is 1.34% + 12% VAT = 1.5008%. If live billing follows the
 * published rate, a ₱400 court is charged 40610 against a stored
 * expectation of 40609 and every booking strands. That is triggered by
 * account activation rather than by any deploy, so it will not announce
 * itself.
 *
 * This does not change the outcome — the booking still does not confirm,
 * correctly, because we cannot verify what was paid. It changes how fast
 * anyone finds out, and it reports the ACTUAL amount, which is the number
 * needed to recalibrate.
 *
 * Only ever called on the failure path, so its extra reads cost nothing
 * in the normal case.
 */
export async function diagnoseUnconfirmedPayment(
  supabase: Client,
  params: { bookingId: string; paidAmount: number; paidCurrency: string; checkoutSessionId: string }
): Promise<PaymentConfirmationDiagnosis> {
  const booking = await getBookingById(supabase, params.bookingId);
  if (!booking) {
    return { kind: "booking_not_found", detail: `booking ${params.bookingId} does not exist` };
  }

  // A redelivered webhook for a booking already confirmed. Expected, and
  // the single most common reason for a false return.
  if (booking.status === "confirmed") {
    return { kind: "already_confirmed", detail: `booking ${booking.confirmation_code} was already confirmed` };
  }

  // The one genuinely alarming case besides amount_mismatch: PayMongo
  // reports this payment succeeded, but the booking is cancelled — most
  // often the pending-booking expiry sweep (cancelled_by is null for a
  // system cancellation; a real user id here means the customer cancelled
  // it themselves, which is its own, separate race). Either way the
  // customer has paid and the booking will not confirm; QR Ph cannot be
  // refunded through PayMongo's API at all (see refunds.ts), so this
  // resolves only as a manual bank transfer.
  if (booking.status === "cancelled") {
    return {
      kind: "cancelled",
      detail:
        `booking ${booking.confirmation_code} is cancelled` +
        (booking.cancelled_by === null
          ? " by an automated process (cancelled_by is null — most likely the pending-booking expiry sweep)"
          : ` by user ${booking.cancelled_by}`) +
        `, but PayMongo reports this payment succeeded. The customer HAS PAID and the booking is cancelled. ` +
        `QR Ph payments cannot be refunded through PayMongo's API — this needs a manual bank transfer.`,
    };
  }

  // A price-increase reschedule's difference checkout charges less than the
  // replacement booking's own price_amount, so this RPC ALWAYS no-ops for
  // it by design — maybeCompleteReschedule() is its real confirmation path.
  // Queried directly rather than through lib/services/reschedules.ts, which
  // imports this module.
  const { data: reschedule } = await supabase
    .from("booking_reschedules")
    .select("id, price_difference")
    .eq("new_booking_id", params.bookingId)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (reschedule) {
    return {
      kind: "reschedule_difference",
      detail: `booking ${booking.confirmation_code} is a reschedule replacement; difference ${reschedule.price_difference} confirms via maybeCompleteReschedule()`,
    };
  }

  if (booking.paymongo_checkout_session_id !== params.checkoutSessionId) {
    return {
      kind: "session_mismatch",
      detail: `booking ${booking.confirmation_code} carries session ${booking.paymongo_checkout_session_id ?? "none"}, payment arrived for ${params.checkoutSessionId}`,
    };
  }

  if (booking.currency.toUpperCase() !== params.paidCurrency.toUpperCase()) {
    return {
      kind: "currency_mismatch",
      detail: `booking ${booking.confirmation_code} is ${booking.currency}, payment was ${params.paidCurrency}`,
    };
  }

  // The expression the RPC checks against — see migration 20260810000054.
  const expected = booking.price_amount - booking.credit_amount_applied + booking.processing_fee_amount;
  if (expected !== params.paidAmount) {
    return {
      kind: "amount_mismatch",
      expected,
      actual: params.paidAmount,
      delta: params.paidAmount - expected,
      detail:
        `booking ${booking.confirmation_code}: PayMongo charged ${params.paidAmount} but we expected ${expected} ` +
        `(price ${booking.price_amount} - credit ${booking.credit_amount_applied} + fee ${booking.processing_fee_amount}); ` +
        `delta ${params.paidAmount - expected}. The customer HAS PAID and this booking will NOT confirm. ` +
        `If the delta is small and consistent, PROCESSING_FEE_PERCENT no longer matches PayMongo's rate — set ` +
        `PAYMONGO_PASS_ON_FEES_ENABLED=false and redeploy, then recalibrate. Do NOT loosen the amount check.`,
    };
  }

  return {
    kind: "unknown",
    detail: `booking ${booking.confirmation_code} did not confirm and no known cause matched (status ${booking.status})`,
  };
}

/**
 * Records a diagnosis at the right volume: a real mismatch means a
 * customer has paid for a booking that will not confirm, and is logged as
 * such. Everything else is ordinary and logged quietly, or not at all.
 *
 * Returns whether it was the alarm case, so callers can surface it.
 */
/**
 * Diagnose and report in one call, and NEVER throw. SERVER ONLY.
 *
 * This is the only form callers should use. Diagnosis runs on the failure
 * path of a payment webhook, and a diagnostic that can throw is worse than
 * no diagnostic at all: in the webhook it turned a 200 into a 500, which
 * makes PayMongo retry the delivery indefinitely and buries the very log
 * line this exists to surface. Caught in review by an existing idempotency
 * test rather than in production.
 *
 * Returns true when the caller should treat this as a real problem.
 */
export async function reportUnconfirmedPaymentSafely(
  supabase: Client,
  source: string,
  params: { bookingId: string; paidAmount: number; paidCurrency: string; checkoutSessionId: string }
): Promise<boolean> {
  try {
    const diagnosis = await diagnoseUnconfirmedPayment(supabase, params);
    return reportUnconfirmedPayment(source, diagnosis);
  } catch (error) {
    // Even the fallback must not throw. Log and carry on — the booking's
    // actual state is unaffected by whether we managed to explain it.
    logServerError(`${source}.diagnosisFailed`, error);
    return false;
  }
}

export function reportUnconfirmedPayment(source: string, diagnosis: PaymentConfirmationDiagnosis): boolean {
  switch (diagnosis.kind) {
    case "already_confirmed":
    case "reschedule_difference":
      // Expected, and both happen routinely. Logging them as failures is
      // what buried the real case.
      return false;
    case "amount_mismatch":
      logServerError(`${source}.PAID_BUT_UNCONFIRMED.amountMismatch`, new Error(diagnosis.detail), { critical: true });
      return true;
    default:
      logServerError(`${source}.PAID_BUT_UNCONFIRMED.${diagnosis.kind}`, new Error(diagnosis.detail), { critical: true });
      return true;
  }
}

/** Twin of confirmBookingPayment() — calls confirm_paymongo_booking_payment() instead. */
export async function confirmPaymongoBookingPayment(
  supabase: Client,
  params: {
    bookingId: string;
    paymongoCheckoutSessionId: string;
    paymongoPaymentIntentId: string;
    expectedAmount: number;
    expectedCurrency: string;
    /**
     * The real Payment id (not the PaymentIntent id above) — what
     * requestRefund() actually needs to call PayMongo's refund/retrieve
     * endpoints. Optional because this is the only privileged path that
     * can set bookings.paymongo_payment_id (see migration
     * 20260810000122's guard); omit only for a caller that genuinely
     * doesn't have it, never to skip populating it for a real payment.
     */
    paymongoPaymentId?: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase.rpc("confirm_paymongo_booking_payment", {
    p_booking_id: params.bookingId,
    p_paymongo_checkout_session_id: params.paymongoCheckoutSessionId,
    p_paymongo_payment_intent_id: params.paymongoPaymentIntentId,
    p_expected_amount: params.expectedAmount,
    p_expected_currency: params.expectedCurrency,
    p_paymongo_payment_id: params.paymongoPaymentId,
  });
  if (error) throw error;
  return data ?? false;
}

/** What reconcilePaymongoPendingBooking() learned, for the caller to render the right waiting screen. */
export type ReconcilePaymongoResult = {
  booking: Booking;
  /**
   * True when PayMongo shows a payment attempt that hasn't resolved to
   * "paid" yet, but also isn't known to have failed — i.e. money may
   * genuinely still be in flight, so the caller should say "processing"
   * rather than "book again". See derivePaymentState() in
   * lib/paymentState.ts, which is what actually consumes this.
   */
  paymentInFlight: boolean;
};

/**
 * Twin of reconcilePendingBooking() — the confirmation page calls this
 * one instead when booking.payment_provider === "paymongo". No external
 * session id parameter is needed (unlike the Stripe version): the
 * checkout session id was already attached to the booking row at
 * checkout-creation time, so this reads it directly rather than trusting
 * anything from the URL.
 */
export async function reconcilePaymongoPendingBooking(supabase: Client, bookingId: string): Promise<ReconcilePaymongoResult> {
  const booking = await getBookingById(supabase, bookingId);
  if (!booking) {
    throw new BookingError("booking_not_found", "We couldn't find that booking.");
  }
  if (booking.status !== "pending" || booking.payment_provider !== "paymongo" || !booking.paymongo_checkout_session_id) {
    return { booking, paymentInFlight: false };
  }

  const session = await retrievePayMongoCheckoutSession(booking.paymongo_checkout_session_id);
  const paymentIntent = session.attributes.payment_intent;
  const payments = paymentIntent?.attributes.payments ?? [];
  const paidPayment = payments.find((p) => p.attributes.status === "paid");
  if (!paymentIntent || !paidPayment) {
    // Only "paid" is a status this project has verified against a real
    // PayMongo response — "failed" is assumed by the same convention
    // (paid/failed being the two terminal states of a payment attempt),
    // not confirmed. Anything that isn't a known-terminal failure counts
    // as possibly still settling, but only within a bounded recent
    // window — otherwise a genuinely stuck or long-abandoned checkout
    // would tell the customer to keep waiting forever.
    const hasNonFailedAttempt = payments.some((p) => p.attributes.status !== "failed");
    const minutesSinceCreated = (Date.now() - new Date(booking.created_at).getTime()) / 60_000;
    const paymentInFlight = hasNonFailedAttempt && minutesSinceCreated <= PAYMONGO_PAYMENT_IN_FLIGHT_WINDOW_MINUTES;
    return { booking, paymentInFlight };
  }

  const confirmed = await confirmPaymongoBookingPayment(supabase, {
    bookingId,
    paymongoCheckoutSessionId: booking.paymongo_checkout_session_id,
    paymongoPaymentIntentId: paymentIntent.id,
    expectedAmount: paidPayment.attributes.amount,
    expectedCurrency: paidPayment.attributes.currency.toUpperCase(),
  });

  // PayMongo says this was paid and our check refused it. That is either
  // ordinary (a reschedule difference, or already confirmed) or an alarm —
  // a customer who has paid for a booking that will not confirm. The
  // result used to be discarded entirely here, so the alarm case was
  // completely silent on this path.
  if (!confirmed) {
    await reportUnconfirmedPaymentSafely(supabase, "bookings.reconcilePaymongo", {
      bookingId,
      paidAmount: paidPayment.attributes.amount,
      paidCurrency: paidPayment.attributes.currency,
      checkoutSessionId: booking.paymongo_checkout_session_id,
    });
  }

  // Purely informational, best-effort — only written when PayMongo's
  // response actually included these fields; never required for
  // confirmation to succeed (already happened above), never used to
  // decide anything. A failure here is logged, never thrown — the
  // booking is already correctly confirmed regardless. See
  // supabase/migrations/20260810000014_paymongo_refund_accounting_scaffolding.sql.
  const { available_at, credited_at } = paidPayment.attributes;
  if (available_at != null || credited_at != null) {
    const { error: settlementUpdateError } = await supabase
      .from("bookings")
      .update({
        ...(available_at != null && { paymongo_available_at: new Date(available_at * 1000).toISOString() }),
        ...(credited_at != null && { paymongo_credited_at: new Date(credited_at * 1000).toISOString() }),
      })
      .eq("id", bookingId);
    if (settlementUpdateError) logServerError("bookings.persistPaymongoSettlementTimestamps", settlementUpdateError);
  }

  const refreshed = await getBookingById(supabase, bookingId);
  // PayMongo reported a paid payment either way, whether or not our own
  // confirm RPC accepted it (see the alarm case above) — a customer who
  // has paid must never be told to book again while that's being sorted
  // out, even in the rare case this booking is still 'pending'.
  return { booking: refreshed ?? booking, paymentInFlight: true };
}
