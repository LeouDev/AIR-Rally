import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingStatus } from "@/lib/supabase/types";
import {
  SLOT_INCREMENT_MINUTES,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_LEAD_TIME_MINUTES,
  MAX_BOOKING_WINDOW_DAYS,
  DEFAULT_CURRENCY,
} from "@/lib/booking-config";
import { retrievePayMongoCheckoutSession } from "@/lib/services/paymongo";
import { logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

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
  | "cancellation_window_passed";

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

export type CreateBookingInput = {
  courtId: string;
  startTime: string;
  endTime: string;
  /**
   * Defaults to "confirmed" — preserves Phase 4A's exact behavior for any
   * caller that doesn't pass this (nothing gated confirmation before
   * Phase 4B). The checkout flow (lib/actions/checkout.ts) is the one
   * caller that passes "pending": Stripe payment is now the thing that
   * gates confirmation, via confirm_booking_payment() once webhook-verified.
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
      status: input.status ?? "confirmed",
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
export async function cancelBooking(supabase: Client, userId: string, bookingId: string): Promise<Booking> {
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
  return cancelled;
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
 * booking is actually going through. `marketplaceSplit`, when given,
 * stores the audit snapshot of what was actually sent to PayMongo's
 * split_payment (see ARCHITECTURE.md's PayMongo Platforms section for why
 * these three columns are owner-writable here rather than bypass-only:
 * they're a record of what happened, never re-read to decide what a live
 * checkout session's real split is).
 */
export async function attachPaymongoCheckoutSession(
  supabase: Client,
  bookingId: string,
  paymongoCheckoutSessionId: string,
  marketplaceSplit?: { platformFeeAmount: number; venueAmount: number; paymongoVenueAccountId: string }
): Promise<void> {
  const { error } = await supabase
    .from("bookings")
    .update({
      payment_provider: "paymongo",
      paymongo_checkout_session_id: paymongoCheckoutSessionId,
      ...(marketplaceSplit && {
        platform_fee_amount: marketplaceSplit.platformFeeAmount,
        venue_amount: marketplaceSplit.venueAmount,
        paymongo_venue_account_id: marketplaceSplit.paymongoVenueAccountId,
      }),
    })
    .eq("id", bookingId);
  if (error) throw error;
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
  }
): Promise<boolean> {
  const { data, error } = await supabase.rpc("confirm_paymongo_booking_payment", {
    p_booking_id: params.bookingId,
    p_paymongo_checkout_session_id: params.paymongoCheckoutSessionId,
    p_paymongo_payment_intent_id: params.paymongoPaymentIntentId,
    p_expected_amount: params.expectedAmount,
    p_expected_currency: params.expectedCurrency,
  });
  if (error) throw error;
  return data ?? false;
}

/**
 * Twin of reconcilePendingBooking() — the confirmation page calls this
 * one instead when booking.payment_provider === "paymongo". No external
 * session id parameter is needed (unlike the Stripe version): the
 * checkout session id was already attached to the booking row at
 * checkout-creation time, so this reads it directly rather than trusting
 * anything from the URL.
 */
export async function reconcilePaymongoPendingBooking(supabase: Client, bookingId: string): Promise<Booking> {
  const booking = await getBookingById(supabase, bookingId);
  if (!booking) {
    throw new BookingError("booking_not_found", "We couldn't find that booking.");
  }
  if (booking.status !== "pending" || booking.payment_provider !== "paymongo" || !booking.paymongo_checkout_session_id) {
    return booking;
  }

  const session = await retrievePayMongoCheckoutSession(booking.paymongo_checkout_session_id);
  const paymentIntent = session.attributes.payment_intent;
  const paidPayment = paymentIntent?.attributes.payments.find((p) => p.attributes.status === "paid");
  if (!paymentIntent || !paidPayment) {
    return booking;
  }

  await confirmPaymongoBookingPayment(supabase, {
    bookingId,
    paymongoCheckoutSessionId: booking.paymongo_checkout_session_id,
    paymongoPaymentIntentId: paymentIntent.id,
    expectedAmount: paidPayment.attributes.amount,
    expectedCurrency: paidPayment.attributes.currency.toUpperCase(),
  });

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
  return refreshed ?? booking;
}
