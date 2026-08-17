"use server";

import { createBooking, cancelBooking, attachPaymongoCheckoutSession, BookingError } from "@/lib/services/bookings";
import { createPayMongoCheckoutSession, PayMongoError } from "@/lib/services/paymongo";
import { getUserCreditBalance, splitBookingPayment, applyCreditToBooking, confirmCreditOnlyBooking } from "@/lib/services/credits";
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
 *
 * AIR/Rally Credits sit between those two steps: the booking's price is
 * settled from the wallet first, and only the remainder — if any — is sent
 * to PayMongo. The whole split is recomputed server-side from the booking's
 * own price_amount and the wallet's own balance, so nothing about it can be
 * influenced by the client.
 */
export async function createCheckoutSessionAction(
  values: CreateBookingValues
): Promise<ActionResult<{ url: string; bookingId: string; creditApplied: number; amountDue: number }>> {
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
    const confirmationUrl = `${siteUrl}/bookings/${booking.id}/confirmation`;

    // The wallet balance is read server-side under the user's own RLS, and
    // the split is computed from it and the booking's own server-computed
    // price. The client never supplies, and cannot influence, either number.
    const { balance } = await getUserCreditBalance(supabase, user.id);
    const { creditApplied, amountDue, fullyCoveredByCredit } = splitBookingPayment({
      priceAmount: booking.price_amount,
      availableCredit: balance,
    });

    if (creditApplied > 0) {
      // Debits the wallet and stamps credit_amount_applied on the booking in
      // one transaction. Its own lock is what makes two simultaneous
      // checkouts safe: the second either sees the reduced balance or fails,
      // never both spending the same credit. If anything below this line
      // throws, the catch cancels the booking and the restore trigger
      // returns these credits automatically.
      await applyCreditToBooking({ userId: user.id, bookingId: booking.id, amount: creditApplied });
    }

    if (fullyCoveredByCredit) {
      // Nothing is owed, so no PayMongo session is created at all. This is
      // the one confirmation path that doesn't run through the webhook,
      // and it is only reachable when the credit covers the full price —
      // the RPC re-checks that itself rather than trusting this branch.
      const confirmed = await confirmCreditOnlyBooking({ userId: user.id, bookingId: booking.id });
      if (!confirmed) {
        throw new BookingError("credit_confirmation_failed", "We couldn't complete this booking with your credits. Please try again.");
      }
      return { success: true, data: { url: confirmationUrl, bookingId: booking.id, creditApplied, amountDue: 0 } };
    }

    // Marketplace split only applies when (a) the platform-wide kill
    // switch is explicitly enabled — see lib/paymongoLaunchGates.ts — AND
    // (b) the venue has a fully activated PayMongo Platforms account.
    // Every other combination falls back to plain, non-split checkout,
    // which collects to the platform account.
    //
    // Computed from amountDue, not price_amount: a split can only divide
    // money PayMongo actually collects, and credit is settled internally.
    // Splitting the full price would promise out more than was received.
    const marketplaceSplit =
      isPaymongoMarketplaceSplitEnabled() && display?.venuePaymongoActivationStatus === "activated" && display.venuePaymongoAccountId
        ? { ...calculateMarketplaceSplit(amountDue), venuePaymongoAccountId: display.venuePaymongoAccountId }
        : undefined;

    // PayMongo Checkout Sessions have no confirmed equivalent of Stripe's
    // {CHECKOUT_SESSION_ID} redirect-time placeholder — the confirmation
    // page instead reads the session id straight off the booking row,
    // already attached below before any redirect happens.
    const session = await createPayMongoCheckoutSession({
      booking,
      venueName: display?.venueName ?? "Air/Rally venue",
      courtName: display?.courtName ?? "Court",
      successUrl: confirmationUrl,
      cancelUrl: `${confirmationUrl}?cancelled=true`,
      // Charge only what the wallet didn't cover. When no credit applied,
      // amountDue === price_amount and this is the pre-credits behaviour
      // exactly. confirm_paymongo_booking_payment() expects this same
      // figure (price_amount - credit_amount_applied), so the two agree by
      // construction rather than by coincidence.
      chargeAmountOverride: amountDue,
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

    return { success: true, data: { url: session.url, bookingId: booking.id, creditApplied, amountDue } };
  } catch (error) {
    // The booking was created but something after it failed — release the
    // slot rather than leaving an unpayable pending booking behind. This
    // also returns any credit already applied: cancelling a pending booking
    // fires the restore trigger, so a failure here never strands a wallet
    // debit against a booking that won't happen.
    if (bookingId) {
      try {
        await cancelBooking(supabase, user.id, bookingId);
      } catch (cleanupError) {
        logServerError("checkout.cleanupFailedPendingBooking", cleanupError);
      }
    }

    // PayMongoError.message is customer-safe by construction (the
    // deployment detail lives on .detail, which the log above captures) —
    // see lib/services/paymongo.ts.
    if (error instanceof BookingError || error instanceof PayMongoError) {
      logServerError(`checkout.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("checkout.createSession", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't start checkout.") };
  }
}
