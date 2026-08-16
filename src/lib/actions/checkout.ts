"use server";

import { createBooking, cancelBooking, attachPaymongoCheckoutSession, BookingError } from "@/lib/services/bookings";
import { createPayMongoCheckoutSession, PayMongoError } from "@/lib/services/paymongo";
import { calculateMarketplaceSplit } from "@/lib/services/commission";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { isPaymongoMarketplaceSplitEnabled } from "@/lib/paymongoLaunchGates";
import { createBookingSchema, type CreateBookingValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Creates a real, reserved (pending) booking and a real PayMongo Checkout
 * Session for it, then returns the URL to redirect the browser to.
 *
 * PayMongo is the only payment provider. Stripe was removed once PayMongo
 * became the platform's provider; `bookings.payment_provider` and the
 * dormant stripe_* columns remain so any historical row would still read
 * correctly, but nothing writes them.
 *
 * Ordering is deliberate and is the actual safety property of this whole
 * flow: the booking is created — and thus reserved via the
 * bookings_no_overlap exclusion constraint — *before* PayMongo is ever
 * contacted. If the database rejects the interval (already booked,
 * outside hours, whatever), no Checkout Session is created and nothing is
 * charged. If the booking succeeds but Checkout Session creation then
 * fails for any reason, the pending booking is cancelled immediately so
 * it doesn't sit there holding a slot nobody can actually pay for.
 *
 * Never create a session for a booking that wasn't successfully created
 * first — see ARCHITECTURE.md's Phase 4B section for why the reverse
 * ordering would risk charging for a slot the database refuses.
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

    // Marketplace split only applies when (a) the platform-wide kill
    // switch is explicitly enabled — see lib/paymongoLaunchGates.ts — AND
    // (b) the venue has a fully activated PayMongo Platforms account.
    // Every other combination falls back to plain, non-split checkout,
    // which collects to the platform account. Computed fresh here from
    // the booking's own server-computed price_amount — never from a
    // client-supplied amount, never from a stale/cached value.
    const marketplaceSplit =
      isPaymongoMarketplaceSplitEnabled() && display?.venuePaymongoActivationStatus === "activated" && display.venuePaymongoAccountId
        ? { ...calculateMarketplaceSplit(booking.price_amount), venuePaymongoAccountId: display.venuePaymongoAccountId }
        : undefined;

    // PayMongo Checkout Sessions have no confirmed equivalent of Stripe's
    // {CHECKOUT_SESSION_ID} redirect-time placeholder — the confirmation
    // page instead reads the session id straight off the booking row,
    // already attached below before any redirect happens.
    const session = await createPayMongoCheckoutSession({
      booking,
      venueName: display?.venueName ?? "Air/Rally venue",
      courtName: display?.courtName ?? "Court",
      successUrl: `${siteUrl}/bookings/${booking.id}/confirmation`,
      cancelUrl: `${siteUrl}/bookings/${booking.id}/confirmation?cancelled=true`,
      marketplaceSplit: marketplaceSplit && {
        platformFeeAmount: marketplaceSplit.platformFeeAmount,
        venuePaymongoAccountId: marketplaceSplit.venuePaymongoAccountId,
      },
    });

    await attachPaymongoCheckoutSession(
      supabase,
      booking.id,
      session.id,
      marketplaceSplit && {
        platformFeeAmount: marketplaceSplit.platformFeeAmount,
        venueAmount: marketplaceSplit.venueAmount,
        paymongoVenueAccountId: marketplaceSplit.venuePaymongoAccountId,
      }
    );

    return { success: true, data: { url: session.url } };
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

    if (error instanceof BookingError || error instanceof PayMongoError) {
      logServerError(`checkout.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("checkout.createSession", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't start checkout.") };
  }
}
