import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingReschedule, Court } from "@/lib/supabase/types";
import { RESCHEDULE_CUTOFF_HOURS } from "@/lib/booking-config";
import {
  createBooking,
  cancelBooking,
  getBookingById,
  attachPaymongoCheckoutSession,
  setBookingMarketplaceSplit,
  BookingError,
} from "@/lib/services/bookings";
import { createPayMongoCheckoutSession, retrievePayMongoCheckoutSession } from "@/lib/services/paymongo";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { getVenueDetail } from "@/lib/services/venues";
import { calculateMarketplaceSplit } from "@/lib/services/commission";
import { requestRefund, RefundError } from "@/lib/services/refunds";
import { isPaymongoMarketplaceSplitEnabled } from "@/lib/paymongoLaunchGates";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

/** Postgres error code for a unique-constraint violation — the real guarantee behind "one in-flight reschedule per booking" (booking_reschedules_one_pending_per_original). */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export type RescheduleErrorReason =
  | "booking_not_found"
  | "booking_not_confirmed"
  | "cutoff_passed"
  | "booking_already_refunded"
  | "booking_is_replacement"
  | "booking_already_rescheduled"
  | "reschedule_in_progress"
  | "different_venue"
  | "new_slot_unavailable"
  | "checkout_session_creation_failed"
  | "refund_failed"
  | "completion_pending_retry"
  | "reschedule_not_found"
  | "reschedule_not_resumable";

/** Typed domain error for the rescheduling layer, mirroring BookingError/RefundError's shape — `message` is already user-safe. */
export class RescheduleError extends Error {
  constructor(
    public reason: RescheduleErrorReason,
    message: string
  ) {
    super(message);
    this.name = "RescheduleError";
  }
}

export type RescheduleEligibility = { eligible: true } | { eligible: false; reason: RescheduleErrorReason; message: string };

/**
 * V1 eligibility rules, checked in this order (cheapest/most-common-reject
 * first): ownership → status → 24h cutoff → no prior succeeded refund →
 * not itself a completed reschedule's replacement → not already
 * rescheduled once → no other reschedule currently in flight. The last
 * check is also enforced at the database level by
 * booking_reschedules_one_pending_per_original — this is the friendly,
 * pre-insert version of that same guarantee.
 */
export async function getRescheduleEligibility(supabase: Client, userId: string, bookingId: string): Promise<RescheduleEligibility> {
  const booking = await getBookingById(supabase, bookingId);
  if (!booking || booking.user_id !== userId) {
    return { eligible: false, reason: "booking_not_found", message: "We couldn't find that booking." };
  }
  if (booking.status !== "confirmed") {
    return { eligible: false, reason: "booking_not_confirmed", message: "Only a confirmed booking can be rescheduled." };
  }
  if (new Date(booking.start_time).getTime() < Date.now() + RESCHEDULE_CUTOFF_HOURS * 60 * 60_000) {
    return {
      eligible: false,
      reason: "cutoff_passed",
      message: `Bookings can only be rescheduled at least ${RESCHEDULE_CUTOFF_HOURS} hours before they start.`,
    };
  }

  const { data: succeededRefund, error: refundError } = await supabase
    .from("booking_refunds")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .limit(1)
    .maybeSingle();
  if (refundError) throw refundError;
  if (succeededRefund) {
    return { eligible: false, reason: "booking_already_refunded", message: "This booking has already been refunded and can't be rescheduled." };
  }

  const { data: asReplacement, error: replacementError } = await supabase
    .from("booking_reschedules")
    .select("id")
    .eq("new_booking_id", bookingId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  if (replacementError) throw replacementError;
  if (asReplacement) {
    return { eligible: false, reason: "booking_is_replacement", message: "A rescheduled booking can't be rescheduled again." };
  }

  const { data: alreadyRescheduled, error: rescheduledError } = await supabase
    .from("booking_reschedules")
    .select("id")
    .eq("original_booking_id", bookingId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  if (rescheduledError) throw rescheduledError;
  if (alreadyRescheduled) {
    return { eligible: false, reason: "booking_already_rescheduled", message: "This booking has already been rescheduled once." };
  }

  const { data: inFlight, error: inFlightError } = await supabase
    .from("booking_reschedules")
    .select("id")
    .eq("original_booking_id", bookingId)
    .in("status", ["pending_payment", "pending_refund"])
    .limit(1)
    .maybeSingle();
  if (inFlightError) throw inFlightError;
  if (inFlight) {
    return { eligible: false, reason: "reschedule_in_progress", message: "A reschedule is already in progress for this booking." };
  }

  return { eligible: true };
}

export type RescheduleOptions = {
  venueId: string;
  venueName: string;
  venueTimezone: string;
  /** Fixed to the original booking's own duration — V1 lets a customer change date/court, not duration. */
  originalDurationMinutes: number;
  originalPriceAmount: number;
  currency: string;
  /** Active courts at the SAME venue only (V1 rule: cross-venue rescheduling isn't allowed). */
  courts: Court[];
};

/** Display data for the reschedule UI — the venue's other active courts plus the original booking's own duration/price, so the client can preview a difference before submitting. */
export async function getRescheduleOptions(supabase: Client, userId: string, bookingId: string): Promise<RescheduleOptions | null> {
  const booking = await getBookingById(supabase, bookingId);
  if (!booking || booking.user_id !== userId) return null;

  const { data: court, error: courtError } = await supabase.from("courts").select("venue_id").eq("id", booking.court_id).maybeSingle();
  if (courtError) throw courtError;
  if (!court) return null;

  const venueDetail = await getVenueDetail(supabase, court.venue_id);
  if (!venueDetail) return null;

  const originalDurationMinutes = Math.round((new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 60_000);

  return {
    venueId: venueDetail.id,
    venueName: venueDetail.name,
    venueTimezone: venueDetail.timezone,
    originalDurationMinutes,
    originalPriceAmount: booking.price_amount,
    currency: booking.currency,
    courts: venueDetail.courts,
  };
}

async function safeCancelReplacement(supabase: Client, userId: string, bookingId: string): Promise<void> {
  try {
    await cancelBooking(supabase, userId, bookingId);
  } catch (error) {
    logServerError("reschedules.cleanupFailedReplacement", error);
  }
}

// complete_reschedule()/mark_reschedule_failed()/record_reschedule_refund_
// success() are restricted to the service_role Postgres role (see the
// production-readiness audit's finding B1 and the long comment in
// 20260810000015_booking_reschedules.sql above complete_reschedule()'s
// definition) — no client-suppliable value can prove a payment/refund
// actually succeeded, so the trust boundary has to be WHICH CODE calls
// these, not what parameters it passes. These three RPCs are called
// ONLY through this same service-role client, never the caller's own
// RLS-scoped `supabase` — do not add a new RPC call site outside this
// file without also restricting it to service_role in a migration.
//
// A fourth, non-RPC use was added for the production-readiness audit's
// "Blocker A": the price-decrease branch's call to refunds.ts's
// requestRefund() also uses this client, because requestRefund()'s
// booking_refunds insert/update is only permitted by that table's RLS
// for an admin session (see 20260810000013_booking_refunds.sql) — an
// ordinary customer session gets a real 42501 there even for a refund
// on their own booking. This module has already independently verified
// (via getRescheduleEligibility()/the ownership check on the original
// booking earlier in createReschedule()) that the customer genuinely
// owns the booking being refunded before this client is ever used for
// it — the same "trust the calling code, not a client-suppliable value"
// reasoning as the three RPCs above, not a broadening of who can reach
// booking_refunds.
let serviceRoleClient: SupabaseClient<Database> | null = null;
function getRescheduleServiceRoleClient(): SupabaseClient<Database> {
  serviceRoleClient ??= createServiceRoleClient();
  return serviceRoleClient;
}

async function completeReschedule(rescheduleId: string, refundId?: string | null): Promise<boolean> {
  const { data, error } = await getRescheduleServiceRoleClient().rpc("complete_reschedule", {
    p_reschedule_id: rescheduleId,
    p_refund_id: refundId ?? null,
  });
  if (error) throw error;
  return data ?? false;
}

async function markRescheduleFailed(
  rescheduleId: string,
  status: "failed" | "provider_unavailable",
  failureReason: string,
  refundId?: string | null
): Promise<boolean> {
  const { data, error } = await getRescheduleServiceRoleClient().rpc("mark_reschedule_failed", {
    p_reschedule_id: rescheduleId,
    p_status: status,
    p_failure_reason: failureReason,
    p_refund_id: refundId ?? null,
  });
  if (error) throw error;
  return data ?? false;
}

/**
 * The durable checkpoint for a decrease reschedule's refund (see the
 * audit's finding B3) — called immediately after requestRefund() reports
 * `succeeded`, BEFORE attempting completeReschedule(). If
 * completeReschedule() then throws, this checkpoint is what makes the
 * failure safely retryable: the reschedule row durably records that the
 * refund already happened, so nothing ever re-calls requestRefund() for
 * it again.
 */
async function recordRescheduleRefundSuccess(rescheduleId: string, refundId: string): Promise<boolean> {
  const { data, error } = await getRescheduleServiceRoleClient().rpc("record_reschedule_refund_success", {
    p_reschedule_id: rescheduleId,
    p_refund_id: refundId,
  });
  if (error) throw error;
  return data ?? false;
}

// --- Price-increase difference checkout -----------------------------
//
async function createDifferenceCheckout(
  supabase: Client,
  params: {
    replacement: Booking;
    newCourtId: string;
    amount: number;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  }
): Promise<string> {
  const display = await getCourtDisplayInfo(supabase, params.newCourtId);
  const venueName = display?.venueName ?? "Air/Rally venue";
  const courtName = display?.courtName ?? "Court";

  const marketplaceSplit =
    isPaymongoMarketplaceSplitEnabled() && display?.venuePaymongoActivationStatus === "activated" && display.venuePaymongoAccountId
      ? { ...calculateMarketplaceSplit(params.amount), venuePaymongoAccountId: display.venuePaymongoAccountId }
      : undefined;

  // Recorded before the session exists, and through the service_role-only
  // RPC — the three split columns are guarded by
  // prevent_booking_tampering(), so the plain update this used to ride
  // along with silently left them NULL. See migration 20260810000056.
  //
  // The snapshot lands on the REPLACEMENT booking but splits only the price
  // difference, which is all PayMongo is asked to collect here. That is why
  // the RPC bounds the split by price_amount rather than requiring equality.
  if (marketplaceSplit) {
    const splitRecorded = await setBookingMarketplaceSplit(params.replacement.id, {
      platformFeeAmount: marketplaceSplit.platformFeeAmount,
      venueAmount: marketplaceSplit.venueAmount,
      paymongoVenueAccountId: marketplaceSplit.venuePaymongoAccountId,
    });
    if (!splitRecorded) {
      throw new RescheduleError("checkout_session_creation_failed", "We couldn't finish this reschedule — please try again.");
    }
  }

  const session = await createPayMongoCheckoutSession({
    booking: params.replacement,
    venueName,
    courtName,
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    chargeAmountOverride: params.amount,
    marketplaceSplit: marketplaceSplit && {
      platformFeeAmount: marketplaceSplit.platformFeeAmount,
      venuePaymongoAccountId: marketplaceSplit.venuePaymongoAccountId,
    },
  });

  await attachPaymongoCheckoutSession(supabase, params.replacement.id, session.id);

  return session.url;
}

export type RescheduleResult =
  | { kind: "completed"; reschedule: BookingReschedule; originalBooking: Booking; newBooking: Booking }
  | { kind: "checkout_required"; reschedule: BookingReschedule; checkoutUrl: string; newBooking: Booking }
  | { kind: "provider_unavailable"; reschedule: BookingReschedule; newBooking: Booking };

export type CreateRescheduleInput = {
  bookingId: string;
  newCourtId: string;
  newStartTime: string;
  newEndTime: string;
  reason?: string | null;
  /**
   * Origin only (e.g. "https://air-rally.app") — the replacement
   * booking's id isn't known until this function creates it, so the full
   * redirect URL is built internally, reusing the EXISTING booking
   * confirmation page (/bookings/[bookingId]/confirmation) rather than a
   * new reschedule-specific route. That page's own reconcile fallback
   * harmlessly no-ops for a difference-only session (its amount check is
   * against the replacement's full price_amount); maybeCompleteReschedule
   * FromProvider() is what actually completes a reschedule from there.
   */
  siteUrl: string;
  customerEmail?: string;
};

/**
 * The one orchestration entry point. Follows the exact ordering the V1
 * spec locks in: the original booking is NEVER cancelled first. The
 * replacement is created (reserving the slot via the same
 * bookings_no_overlap constraint every other booking gets "for free" from
 * createBooking()), then a booking_reschedules row records the attempt,
 * then exactly one of three financial paths runs, and only once that
 * financial step has actually succeeded does complete_reschedule()
 * atomically confirm the replacement + cancel the original + mark the
 * reschedule completed. If any financial step fails, the original is
 * never touched and the replacement never becomes active — see
 * markRescheduleFailed()/safeCancelReplacement() below.
 */
export async function createReschedule(supabase: Client, userId: string, input: CreateRescheduleInput): Promise<RescheduleResult> {
  const eligibility = await getRescheduleEligibility(supabase, userId, input.bookingId);
  if (!eligibility.eligible) {
    throw new RescheduleError(eligibility.reason, eligibility.message);
  }

  const original = await getBookingById(supabase, input.bookingId);
  if (!original) {
    throw new RescheduleError("booking_not_found", "We couldn't find that booking.");
  }

  const { data: originalCourt, error: originalCourtError } = await supabase
    .from("courts")
    .select("venue_id")
    .eq("id", original.court_id)
    .maybeSingle();
  if (originalCourtError) throw originalCourtError;
  const { data: newCourt, error: newCourtError } = await supabase.from("courts").select("venue_id").eq("id", input.newCourtId).maybeSingle();
  if (newCourtError) throw newCourtError;
  if (!originalCourt || !newCourt || originalCourt.venue_id !== newCourt.venue_id) {
    throw new RescheduleError("different_venue", "The replacement court must belong to the same venue as the original booking.");
  }

  let replacement: Booking;
  try {
    replacement = await createBooking(supabase, userId, {
      courtId: input.newCourtId,
      startTime: input.newStartTime,
      endTime: input.newEndTime,
      status: "pending",
    });
  } catch (error) {
    if (error instanceof BookingError) {
      throw new RescheduleError("new_slot_unavailable", error.message);
    }
    throw error;
  }

  const priceDifference = replacement.price_amount - original.price_amount;

  const { data: reschedule, error: insertError } = await supabase
    .from("booking_reschedules")
    .insert({
      original_booking_id: original.id,
      new_booking_id: replacement.id,
      price_difference: priceDifference,
      initiated_by: userId,
      reason: input.reason ?? null,
    })
    .select("*")
    .single();

  if (insertError) {
    await safeCancelReplacement(supabase, userId, replacement.id);
    if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new RescheduleError("reschedule_in_progress", "A reschedule is already in progress for this booking.");
    }
    throw insertError;
  }

  if (priceDifference === 0) {
    const completed = await completeReschedule(reschedule.id);
    if (!completed) {
      await safeCancelReplacement(supabase, userId, replacement.id);
      throw new RescheduleError("checkout_session_creation_failed", "We couldn't finish this reschedule — please try again.");
    }
    const [refreshedOriginal, refreshedReplacement] = await Promise.all([
      getBookingById(supabase, original.id),
      getBookingById(supabase, replacement.id),
    ]);
    return {
      kind: "completed",
      reschedule: { ...reschedule, status: "completed" },
      originalBooking: refreshedOriginal ?? original,
      newBooking: refreshedReplacement ?? replacement,
    };
  }

  if (priceDifference > 0) {
    // Checkout creation failing here deliberately leaves the reschedule
    // row in pending_payment (retryable via resumeRescheduleCheckout)
    // rather than a terminal "failed" — the replacement stays pending
    // (never active), satisfying "additional payment failure: the
    // customer can retry later" without losing the reservation attempt.
    const checkoutUrl = await createDifferenceCheckout(supabase, {
      replacement,
      newCourtId: input.newCourtId,
      amount: priceDifference,
      successUrl: `${input.siteUrl}/bookings/${replacement.id}/confirmation`,
      cancelUrl: `${input.siteUrl}/bookings/${replacement.id}/confirmation?cancelled=true`,
      customerEmail: input.customerEmail,
    });
    return { kind: "checkout_required", reschedule, checkoutUrl, newBooking: replacement };
  }

  // priceDifference < 0: a gross-only refund of the difference (V1 rule —
  // refund_basis is always "gross_only", never gross_plus_fee).
  const refundAmount = -priceDifference;
  let refund: Awaited<ReturnType<typeof requestRefund>>;
  try {
    // Service-role client, deliberately NOT the caller's own `supabase` —
    // see the production-readiness audit's "Blocker A" and the comment
    // above getRescheduleServiceRoleClient()'s definition. `original` was
    // already fetched and ownership-checked earlier in this same function
    // under the customer's own session; this call only ever runs after
    // that verification has already passed.
    refund = await requestRefund(getRescheduleServiceRoleClient(), {
      booking: original,
      amount: refundAmount,
      reason: input.reason ?? "Booking reschedule — price decrease",
      initiatedBy: userId,
      refundBasis: "gross_only",
    });
  } catch (error) {
    if (error instanceof RefundError) {
      await markRescheduleFailed(reschedule.id, "failed", error.message);
      await safeCancelReplacement(supabase, userId, replacement.id);
      throw new RescheduleError("refund_failed", error.message);
    }
    throw error;
  }

  if (refund.status === "provider_unavailable") {
    // QR Ph (or any other provider-confirmed-unrefundable method):
    // never pretend the reschedule completed. The original stays
    // active/untouched; the replacement is released so it never
    // becomes an active double booking.
    await markRescheduleFailed(reschedule.id, "provider_unavailable", refund.failure_reason ?? "Refund unavailable through the payment provider.", refund.id);
    await safeCancelReplacement(supabase, userId, replacement.id);
    return { kind: "provider_unavailable", reschedule: { ...reschedule, status: "provider_unavailable" }, newBooking: replacement };
  }

  if (refund.status !== "succeeded") {
    await markRescheduleFailed(reschedule.id, "failed", refund.failure_reason ?? "Refund failed.", refund.id);
    await safeCancelReplacement(supabase, userId, replacement.id);
    throw new RescheduleError("refund_failed", "We couldn't process the refund for this reschedule — please try again.");
  }

  // The refund genuinely succeeded — durably checkpoint this BEFORE
  // attempting completion (see the production-readiness audit's finding
  // B3), so a failure in the next step is safely retryable without ever
  // re-calling requestRefund() again. From this point on, "the refund
  // succeeded" is a fact recorded in the database, not just a JS
  // variable that could be lost to a crash.
  const checkpointed = await recordRescheduleRefundSuccess(reschedule.id, refund.id);
  if (!checkpointed) {
    // Extremely rare: the row was no longer pending_payment by the time
    // we tried to checkpoint. The refund already succeeded and is
    // permanently recorded in booking_refunds regardless of this —
    // logged for manual follow-up rather than guessed at.
    logServerError(
      `reschedules.recordRescheduleRefundSuccess.noOp reschedule=${reschedule.id} refund=${refund.id}`,
      new Error("checkpoint did not apply — row was not pending_payment")
    );
  }

  try {
    const completed = await completeReschedule(reschedule.id, refund.id);
    if (!completed) {
      logServerError(
        `reschedules.completeReschedule.noOpAfterRefund reschedule=${reschedule.id} refund=${refund.id}`,
        new Error("completion did not transition — reschedule was not pending")
      );
    }
  } catch (error) {
    // The refund already succeeded and is durably checkpointed
    // (status='pending_refund', refund_id set) — never retry the refund
    // itself, never mark this reschedule failed (mark_reschedule_failed()
    // refuses a pending_refund row at the database level for exactly this
    // reason), and never touch the replacement booking. The only safe
    // recovery from here is retrying completion — see
    // retryRescheduleCompletion() — which is itself idempotent via
    // complete_reschedule()'s own WHERE clause.
    logServerError(`reschedules.completeReschedule.threwAfterRefund reschedule=${reschedule.id} refund=${refund.id}`, error, {
      critical: true,
    });
    throw new RescheduleError(
      "completion_pending_retry",
      "Your refund succeeded, but we couldn't finish updating your booking. This will be resolved automatically — contact support if it isn't within a few minutes."
    );
  }

  const [refreshedOriginal, refreshedReplacement] = await Promise.all([
    getBookingById(supabase, original.id),
    getBookingById(supabase, replacement.id),
  ]);
  return {
    kind: "completed",
    reschedule: { ...reschedule, status: "completed", refund_id: refund.id },
    originalBooking: refreshedOriginal ?? original,
    newBooking: refreshedReplacement ?? replacement,
  };
}

/**
 * "Customer can retry later" for an additional-payment failure (V1 rule):
 * re-issues a fresh checkout session for an existing pending_payment
 * reschedule's already-computed price difference, without creating a
 * second replacement booking or a second reschedule row.
 */
export async function resumeRescheduleCheckout(
  supabase: Client,
  userId: string,
  rescheduleId: string,
  urls: { siteUrl: string; customerEmail?: string }
): Promise<string> {
  const { data: reschedule, error } = await supabase.from("booking_reschedules").select("*").eq("id", rescheduleId).maybeSingle();
  if (error) throw error;
  if (!reschedule || reschedule.initiated_by !== userId) {
    throw new RescheduleError("reschedule_not_found", "We couldn't find that reschedule request.");
  }
  if (reschedule.status !== "pending_payment" || reschedule.price_difference <= 0) {
    throw new RescheduleError("reschedule_not_resumable", "This reschedule isn't waiting on a payment.");
  }

  const original = await getBookingById(supabase, reschedule.original_booking_id);
  const replacement = await getBookingById(supabase, reschedule.new_booking_id);
  if (!original || !replacement) {
    throw new RescheduleError("booking_not_found", "We couldn't find the bookings for this reschedule.");
  }

  // Best-effort supersession of the PREVIOUS attempt (see the
  // production-readiness audit's finding B4): expiring the old Stripe
  // session means a customer who still has that old checkout tab open
  // can no longer pay through it at all. This is a nice-to-have, not the
  // real guarantee — attachCheckoutSession()/attachPaymongoCheckoutSession()
  // below overwriting the replacement's stored session id is what
  // actually makes an older session's webhook unable to complete the
  // reschedule (maybeCompleteReschedule() only accepts a session id that
  // matches the CURRENTLY stored one — see that function). No equivalent
  // PayMongo session-expiration endpoint has been verified in this
  // project, so this is Stripe-only; never invented for PayMongo.

  return createDifferenceCheckout(supabase, {
    replacement,
    newCourtId: replacement.court_id,
    amount: reschedule.price_difference,
    successUrl: `${urls.siteUrl}/bookings/${replacement.id}/confirmation`,
    cancelUrl: `${urls.siteUrl}/bookings/${replacement.id}/confirmation?cancelled=true`,
    customerEmail: urls.customerEmail,
  });
}

/**
 * Given a reschedule stuck at 'pending_refund' (its refund already
 * succeeded and is durably checkpointed, but a prior completeReschedule()
 * call threw before finishing — see createReschedule()'s decrease branch
 * and the production-readiness audit's finding B3), safely retries just
 * the completion step. Never re-requests a refund. Idempotent via
 * complete_reschedule()'s own WHERE clause — safe to call any number of
 * times, including concurrently.
 */
export async function retryRescheduleCompletion(supabase: Client, rescheduleId: string): Promise<boolean> {
  const { data: reschedule, error } = await supabase.from("booking_reschedules").select("*").eq("id", rescheduleId).maybeSingle();
  if (error) throw error;
  if (!reschedule || reschedule.status !== "pending_refund" || !reschedule.refund_id) return false;

  return completeReschedule(reschedule.id, reschedule.refund_id);
}

/**
 * Webhook-side completion for a price-increase reschedule: the amount and
 * session id are already known and signature-verified by the caller (the
 * webhook route), so this only needs to look up a matching pending_payment
 * reschedule and verify (a) the charged amount equals its stored
 * price_difference exactly, (b) the charged currency matches the
 * replacement booking's own currency, and (c) the session that was
 * actually paid is the CURRENT one stored on the replacement booking —
 * never trusting anything beyond that match. A booking id that isn't any
 * reschedule's replacement (the overwhelming majority of webhook
 * deliveries) is a safe, cheap no-op.
 *
 * The session-id check (see the production-readiness audit's finding B4)
 * is what stops a late webhook from an OLDER, superseded checkout
 * session — e.g. a customer who retried via resumeRescheduleCheckout()
 * and then paid BOTH the old and new sessions — from creating a second
 * valid completion. attachCheckoutSession()/attachPaymongoCheckoutSession()
 * overwrite the replacement's stored session id on every new attempt, so
 * only the most recent one is ever "current."
 */
export async function maybeCompleteReschedule(
  supabase: Client,
  bookingId: string,
  expectedAmount: number,
  expectedCurrency: string,
  providerSessionId: string
): Promise<boolean> {
  const { data: reschedule, error } = await supabase
    .from("booking_reschedules")
    .select("*")
    .eq("new_booking_id", bookingId)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (error) throw error;
  if (!reschedule) return false;

  if (reschedule.price_difference !== expectedAmount) {
    logServerError(
      "reschedules.maybeCompleteReschedule.amountMismatch",
      new Error(`reschedule ${reschedule.id}: expected difference ${reschedule.price_difference}, got ${expectedAmount}`)
    );
    return false;
  }

  const replacement = await getBookingById(supabase, bookingId);
  if (!replacement) return false;

  if (replacement.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    logServerError(
      "reschedules.maybeCompleteReschedule.currencyMismatch",
      new Error(`reschedule ${reschedule.id}: expected currency ${replacement.currency}, got ${expectedCurrency}`)
    );
    return false;
  }

  const currentSessionId = replacement.payment_provider === "paymongo" ? replacement.paymongo_checkout_session_id : replacement.stripe_checkout_session_id;
  if (!currentSessionId || currentSessionId !== providerSessionId) {
    logServerError(
      "reschedules.maybeCompleteReschedule.staleSession",
      new Error(`reschedule ${reschedule.id}: session ${providerSessionId} is not the currently active checkout session`)
    );
    return false;
  }

  return completeReschedule(reschedule.id);
}

/**
 * The "confirmation page loads before the webhook lands" fallback for a
 * price-increase reschedule — mirrors reconcilePendingBooking()/
 * reconcilePaymongoPendingBooking() in lib/services/bookings.ts, but
 * self-contained here rather than touching those (this booking's stored
 * checkout session charged only the difference, never the full
 * price_amount those functions check against). Real provider calls, never
 * a cache or a trust-the-URL shortcut. Inherently only ever checks the
 * CURRENTLY stored session id (read fresh off the replacement booking
 * right here), so it already satisfies the same "only the latest attempt
 * can complete" guarantee maybeCompleteReschedule() enforces explicitly.
 */
export async function maybeCompleteRescheduleFromProvider(supabase: Client, bookingId: string): Promise<boolean> {
  const { data: reschedule, error } = await supabase
    .from("booking_reschedules")
    .select("*")
    .eq("new_booking_id", bookingId)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (error) throw error;
  if (!reschedule) return false;

  const replacement = await getBookingById(supabase, bookingId);
  if (!replacement || replacement.status !== "pending") return false;

  let paidAmount: number | null = null;
  let paidCurrency: string | null = null;
  if (replacement.paymongo_checkout_session_id) {
    const session = await retrievePayMongoCheckoutSession(replacement.paymongo_checkout_session_id);
    const paidPayment = session.attributes.payment_intent?.attributes.payments.find((p) => p.attributes.status === "paid");
    paidAmount = paidPayment?.attributes.amount ?? null;
    paidCurrency = paidPayment?.attributes.currency ?? null;
  }

  if (paidAmount == null || paidAmount !== reschedule.price_difference) return false;
  if (!paidCurrency || paidCurrency.toUpperCase() !== replacement.currency.toUpperCase()) return false;

  return completeReschedule(reschedule.id);
}

/** Every reschedule row touching a booking, either as its original or its replacement — for a booking-detail view. */
export async function listReschedulesForBooking(supabase: Client, bookingId: string): Promise<BookingReschedule[]> {
  const { data, error } = await supabase
    .from("booking_reschedules")
    .select("*")
    .or(`original_booking_id.eq.${bookingId},new_booking_id.eq.${bookingId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Batched variant for a list view (e.g. My Bookings) — one query instead of one per booking, keyed by original_booking_id only (the direction My Bookings needs: "was this specific booking rescheduled"). */
export async function listReschedulesForOriginalBookings(supabase: Client, bookingIds: string[]): Promise<Map<string, BookingReschedule[]>> {
  if (bookingIds.length === 0) return new Map();
  const { data, error } = await supabase.from("booking_reschedules").select("*").in("original_booking_id", bookingIds).order("created_at", { ascending: false });
  if (error) throw error;
  const byBooking = new Map<string, BookingReschedule[]>();
  for (const reschedule of data) {
    const existing = byBooking.get(reschedule.original_booking_id) ?? [];
    existing.push(reschedule);
    byBooking.set(reschedule.original_booking_id, existing);
  }
  return byBooking;
}

export type RescheduleActivityRow = {
  id: string;
  status: BookingReschedule["status"];
  priceDifference: number;
  currency: string;
  reason: string | null;
  failureReason: string | null;
  createdAt: string;
  originalConfirmationCode: string;
  originalVenueName: string;
  originalCourtName: string;
  newConfirmationCode: string;
};

/**
 * Admin-only reschedule activity feed — same "RLS already covers this,
 * the caller just needs to be an admin first" posture as
 * listPaymentMonitoringRows(). Two batched lookups (not per-row queries):
 * bookings don't expose two distinct embeddable relationships to the same
 * table from one PostgREST select, so the original/replacement bookings
 * are fetched by id in bulk instead of joined.
 */
export async function listRescheduleActivity(supabase: Client, limit = 200): Promise<RescheduleActivityRow[]> {
  const { data: reschedules, error } = await supabase
    .from("booking_reschedules")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!reschedules || reschedules.length === 0) return [];

  const bookingIds = Array.from(new Set(reschedules.flatMap((r) => [r.original_booking_id, r.new_booking_id])));
  const { data: bookingRows, error: bookingsError } = await supabase
    .from("bookings")
    .select("id, confirmation_code, currency, courts(name, venues(name))")
    .in("id", bookingIds);
  if (bookingsError) throw bookingsError;

  const bookingsById = new Map((bookingRows ?? []).map((row) => [row.id, row]));

  return reschedules.map((reschedule) => {
    const original = bookingsById.get(reschedule.original_booking_id);
    const replacement = bookingsById.get(reschedule.new_booking_id);
    const originalCourt = original && (Array.isArray(original.courts) ? original.courts[0] : original.courts);
    const originalVenue = originalCourt && (Array.isArray(originalCourt.venues) ? originalCourt.venues[0] : originalCourt.venues);

    return {
      id: reschedule.id,
      status: reschedule.status,
      priceDifference: reschedule.price_difference,
      currency: original?.currency ?? "PHP",
      reason: reschedule.reason,
      failureReason: reschedule.failure_reason,
      createdAt: reschedule.created_at,
      originalConfirmationCode: original?.confirmation_code ?? "—",
      originalVenueName: originalVenue?.name ?? "Venue",
      originalCourtName: originalCourt?.name ?? "Court",
      newConfirmationCode: replacement?.confirmation_code ?? "—",
    };
  });
}
