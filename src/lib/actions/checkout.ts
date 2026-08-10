"use server";

import { createBooking, cancelBooking, attachCheckoutSession, attachPaymongoCheckoutSession, BookingError } from "@/lib/services/bookings";
import { createCheckoutSession, PaymentError } from "@/lib/services/payments";
import { createPayMongoCheckoutSession, PayMongoError } from "@/lib/services/paymongo";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { createBookingSchema, type CreateBookingValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Experimental, switchable second provider (see ARCHITECTURE.md's
 * PayMongo TEST MODE section) — defaults to "stripe" so every existing
 * deployment's behavior is unchanged unless this is explicitly opted into.
 * Read once per request rather than cached at module scope, matching how
 * every other env-derived value in this codebase is read.
 */
function getActivePaymentProvider(): "stripe" | "paymongo" {
  return process.env.ACTIVE_PAYMENT_PROVIDER === "paymongo" ? "paymongo" : "stripe";
}

/**
 * Creates a real, reserved (pending) booking and a real Stripe Checkout
 * Session for it, then returns the URL to redirect the browser to.
 *
 * Ordering is deliberate and is the actual safety property of this whole
 * flow: the booking is created — and thus reserved via the
 * bookings_no_overlap exclusion constraint — *before* Stripe is ever
 * contacted. If the database rejects the interval (already booked,
 * outside hours, whatever), no Checkout Session is created and nothing is
 * charged. If the booking succeeds but Checkout Session creation then
 * fails for any reason, the pending booking is cancelled immediately so
 * it doesn't sit there holding a slot nobody can actually pay for.
 *
 * Never create a Stripe session for a booking that wasn't successfully
 * created first — see ARCHITECTURE.md's Phase 4B section for why the
 * reverse ordering would risk charging for a slot the database refuses.
 */
export async function createCheckoutSessionAction(values: CreateBookingValues): Promise<ActionResult<{ url: string }>> {
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

  let bookingId: string | undefined;

  try {
    const booking = await createBooking(supabase, user.id, {
      courtId: parsed.data.courtId,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      status: "pending",
    });
    bookingId = booking.id;

    const display = await getCourtDisplayInfo(supabase, parsed.data.courtId);
    const siteUrl = await getSiteUrl();
    const provider = getActivePaymentProvider();

    let checkoutUrl: string;

    if (provider === "paymongo") {
      // PayMongo Checkout Sessions have no confirmed equivalent of
      // Stripe's {CHECKOUT_SESSION_ID} redirect-time placeholder (not
      // guessing one) — the confirmation page instead reads the session
      // id straight off the booking row, already attached below before
      // any redirect happens.
      const session = await createPayMongoCheckoutSession({
        booking,
        venueName: display?.venueName ?? "Air/Rally venue",
        courtName: display?.courtName ?? "Court",
        successUrl: `${siteUrl}/bookings/${booking.id}/confirmation`,
        cancelUrl: `${siteUrl}/bookings/${booking.id}/confirmation?cancelled=true`,
      });
      await attachPaymongoCheckoutSession(supabase, booking.id, session.id);
      checkoutUrl = session.url;
    } else {
      const session = await createCheckoutSession({
        booking,
        venueName: display?.venueName ?? "Air/Rally venue",
        courtName: display?.courtName ?? "Court",
        successUrl: `${siteUrl}/bookings/${booking.id}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${siteUrl}/bookings/${booking.id}/confirmation?cancelled=true`,
        customerEmail: user.email,
      });
      if (!session.url) {
        throw new PaymentError("checkout_session_creation_failed", "We couldn't start checkout — please try again.");
      }
      await attachCheckoutSession(supabase, booking.id, session.id);
      checkoutUrl = session.url;
    }

    return { success: true, data: { url: checkoutUrl } };
  } catch (error) {
    // The booking was created but something after it failed — release the
    // slot rather than leaving an unpayable pending booking behind.
    if (bookingId) {
      try {
        await cancelBooking(supabase, user.id, bookingId);
      } catch (cleanupError) {
        logServerError("checkout.cleanupFailedPendingBooking", cleanupError);
      }
    }

    if (error instanceof BookingError || error instanceof PaymentError || error instanceof PayMongoError) {
      logServerError(`checkout.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("checkout.createSession", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't start checkout.") };
  }
}
