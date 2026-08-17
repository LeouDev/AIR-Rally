"use server";

import { revalidatePath } from "next/cache";
import { createBooking, cancelBooking, getBookingById, BookingError, type CancelBookingResult } from "@/lib/services/bookings";
import { resolveCancellationCredit, type CancellationCreditDecision } from "@/lib/services/credits";
import { calculateRefundCredit } from "@/lib/services/bookingFee";
import { createBookingSchema, cancelBookingSchema, type CreateBookingValues, type CancelBookingValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Booking } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function createBookingAction(values: CreateBookingValues): Promise<ActionResult<Booking>> {
  const parsed = createBookingSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to book a court." };
  }

  try {
    const booking = await createBooking(supabase, user.id, {
      courtId: parsed.data.courtId,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });
    revalidatePath("/bookings");
    return { success: true, data: booking };
  } catch (error) {
    if (error instanceof BookingError) {
      logServerError(`booking.create.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("booking.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't create that booking.") };
  }
}

export async function cancelBookingAction(values: CancelBookingValues): Promise<ActionResult<CancelBookingResult>> {
  const parsed = cancelBookingSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const { booking, credit } = await cancelBooking(supabase, user.id, parsed.data.bookingId);
    revalidatePath("/bookings");
    // The credit decision travels with the result so the UI can STATE what
    // happened to the customer's money. Cancelling and saying nothing reads
    // as "they kept it", and recomputing the policy in a component is how
    // the two implementations drift apart.
    return { success: true, data: { booking, credit } };
  } catch (error) {
    if (error instanceof BookingError) {
      logServerError(`booking.cancel.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("booking.cancel", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't cancel that booking.") };
  }
}

/**
 * What WOULD happen to the customer's money if they cancelled right now —
 * computed without cancelling anything.
 *
 * Exists because the confirm dialog is shown BEFORE the cancellation, so
 * it cannot use cancelBookingAction's result: that only exists once the
 * booking is already gone. Telling someone what they are about to lose
 * only after they have lost it is the wrong order.
 *
 * resolveCancellationCredit() is PURE — the same function cancelBooking()
 * uses — so this states the real decision rather than a second
 * implementation of the policy. That matters concretely here: the design
 * doc says "more than 24 hours" while CANCELLATION_CREDIT_CUTOFF_HOURS is
 * 48, and a component reimplementing the rule would have shipped the wrong
 * number confidently.
 *
 * READ-ONLY. Cancels nothing, writes nothing, issues no credit.
 */
export async function previewCancellationAction(values: CancelBookingValues): Promise<ActionResult<CancellationCreditDecision>> {
  const parsed = cancelBookingSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const booking = await getBookingById(supabase, parsed.data.bookingId);
    // Same ownership rule as cancelBooking(). A preview of someone else's
    // booking leaks what they paid.
    if (!booking || booking.user_id !== user.id) {
      return { success: false, error: "We couldn't find that booking." };
    }

    if (!booking.paid_at) {
      return {
        success: true,
        data: { amount: 0, eligible: false, reason: "This booking hasn't been paid, so there's nothing to refund." },
      };
    }

    // Credit spent on a secured court is final — cancelBooking() refuses
    // this outright. Said here too so the dialog states it BEFORE the
    // customer commits, rather than letting them click cancel and meet an
    // error. Mirrors the same confirmed-only condition; a pending booking
    // stays cancellable and its credit is restored by migration
    // 20260810000037.
    if (booking.status === "confirmed" && booking.credit_amount_applied > 0) {
      return {
        success: true,
        data: {
          amount: 0,
          eligible: false,
          reason: "Bookings paid with AIR/Rally Credits can't be cancelled, and the credits aren't returned.",
        },
      };
    }

    return {
      success: true,
      data: resolveCancellationCredit({
        // The refundable base — the court price, not what was charged. The
        // processing fee is not refundable; see calculateRefundCredit().
        amountPaid: calculateRefundCredit(booking),
        cause: "customer",
        startTime: booking.start_time,
        now: Date.now(),
      }),
    };
  } catch (error) {
    logServerError("booking.previewCancellation", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't check this booking.") };
  }
}
