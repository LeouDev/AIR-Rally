import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  createBooking,
  cancelBooking,
  attachPaymongoCheckoutSession,
  setBookingProcessingFee,
  setBookingMarketplaceSplit,
  BookingError,
} from "@/lib/services/bookings";
import { createPayMongoCheckoutSession, PayMongoError } from "@/lib/services/paymongo";
import { getUserCreditBalance, splitBookingPayment, applyCreditToBooking, confirmCreditOnlyBooking } from "@/lib/services/credits";
import { calculateMarketplaceSplit } from "@/lib/services/commission";
import { calculateBookingCharge } from "@/lib/services/bookingFee";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { isPaymongoMarketplaceSplitEnabled, isPaymongoPassOnFeesEnabled } from "@/lib/paymongoLaunchGates";
import type { CreateBookingValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

/** Where the customer's browser goes after PayMongo, plus where a
 * credit-only booking (no PayMongo session at all) should land. Built per
 * caller: the web action points all three at the booking's confirmation
 * page; the mobile API points them at the /payment-return bounce page
 * that deep-links back into the app. */
export type CheckoutRedirects = {
  successUrl: string;
  cancelUrl: string;
  confirmationUrl: string;
};

export type CheckoutSessionOutcome = {
  url: string;
  bookingId: string;
  creditApplied: number;
  amountDue: number;
};

/**
 * The whole checkout pipeline — booking reserved first, credits applied,
 * PayMongo session only for the remainder — shared verbatim between the
 * web server action (lib/actions/checkout.ts) and the mobile bearer-auth
 * route (app/api/mobile/checkout/route.ts). Ordering and safety
 * properties are documented on the action, which existed first; the only
 * thing callers vary is where PayMongo sends the browser afterwards.
 *
 * Throws (BookingError, PayMongoError, or unknown) rather than returning
 * an ActionResult — after cancelling the just-created pending booking so
 * a failure never strands a slot or a wallet debit. Callers translate to
 * their own envelope via describeCheckoutError().
 */
export async function createCheckoutSessionForUser(
  supabase: Client,
  userId: string,
  values: CreateBookingValues,
  buildRedirects: (bookingId: string) => CheckoutRedirects
): Promise<CheckoutSessionOutcome> {
  let bookingId: string | undefined;

  try {
    const booking = await createBooking(supabase, userId, {
      courtId: values.courtId,
      startTime: values.startTime,
      endTime: values.endTime,
      status: "pending",
    });
    bookingId = booking.id;

    const display = await getCourtDisplayInfo(supabase, values.courtId);
    const redirects = buildRedirects(booking.id);

    // The wallet balance is read server-side under the user's own RLS, and
    // the split is computed from it and the booking's own server-computed
    // price. The client never supplies, and cannot influence, either number.
    const { balance } = await getUserCreditBalance(supabase, userId);
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
      await applyCreditToBooking({ userId, bookingId: booking.id, amount: creditApplied });
    }

    if (fullyCoveredByCredit) {
      // Nothing is owed, so no PayMongo session is created at all. This is
      // the one confirmation path that doesn't run through the webhook,
      // and it is only reachable when the credit covers the full price —
      // the RPC re-checks that itself rather than trusting this branch.
      const confirmed = await confirmCreditOnlyBooking({ userId, bookingId: booking.id });
      if (!confirmed) {
        throw new BookingError("credit_confirmation_failed", "We couldn't complete this booking with your credits. Please try again.");
      }
      return { url: redirects.confirmationUrl, bookingId: booking.id, creditApplied, amountDue: 0 };
    }

    // What PayMongo will add on top, and what the webhook must therefore
    // expect. Grossed up from amountDue — the POST-credit figure — because
    // PayMongo's rate applies to what it actually collects. Grossing up
    // from price_amount would over-charge anyone paying partly in credit
    // (a ₱400 booking with ₱100 of credit is collected on ₱300, so its fee
    // is ₱300's, not ₱400's).
    //
    // Stored BEFORE the Checkout Session exists. The moment a session is
    // live the customer can pay it, and confirm_paymongo_booking_payment()
    // reads this column to build its expectation — a fee written after the
    // session would leave a window where a real payment cannot confirm.
    //
    // When the gate is off, PayMongo adds nothing and this stays 0, which
    // is the pre-existing behaviour exactly.
    const passOnFees = isPaymongoPassOnFeesEnabled();
    const processingFeeAmount = passOnFees ? calculateBookingCharge(amountDue).processingFeeAmount : 0;

    if (processingFeeAmount > 0) {
      const feeRecorded = await setBookingProcessingFee(booking.id, processingFeeAmount);
      if (!feeRecorded) {
        // The RPC refuses anything but a pending booking within its price
        // bound. Failing the checkout here is the safe direction: the
        // alternative is charging a grossed-up total the webhook would
        // reject, which is the stuck-on-pending outage this feature was
        // built to end.
        throw new BookingError("processing_fee_not_recorded", "We couldn't start checkout. Please try again.");
      }
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

    // Snapshotted BEFORE the Checkout Session exists, for the same reason
    // the processing fee is: once a session is live the customer can pay
    // it, and a snapshot written after that leaves a window where a real,
    // really-split payment has no local record of where it was routed.
    // Nothing recovers that after the fact — PayMongo has already moved the
    // money by then.
    //
    // This must go through the RPC. All three columns are guarded by
    // prevent_booking_tampering(), which reverts silently rather than
    // raising, so the plain update this used to ride along with left them
    // NULL and reported success (verified on staging — see
    // scripts/verify-staging-marketplace-split-snapshot.ts).
    if (marketplaceSplit) {
      const splitRecorded = await setBookingMarketplaceSplit(booking.id, {
        platformFeeAmount: marketplaceSplit.platformFeeAmount,
        venueAmount: marketplaceSplit.venueAmount,
        paymongoVenueAccountId: marketplaceSplit.venuePaymongoAccountId,
      });
      if (!splitRecorded) {
        throw new BookingError("marketplace_split_not_recorded", "We couldn't start checkout. Please try again.");
      }
    }

    // PayMongo Checkout Sessions have no confirmed equivalent of Stripe's
    // {CHECKOUT_SESSION_ID} redirect-time placeholder — the confirmation
    // page instead reads the session id straight off the booking row,
    // already attached below before any redirect happens.
    const session = await createPayMongoCheckoutSession({
      booking,
      venueName: display?.venueName ?? "Air/Rally venue",
      courtName: display?.courtName ?? "Court",
      successUrl: redirects.successUrl,
      cancelUrl: redirects.cancelUrl,
      // Charge only what the wallet didn't cover. When no credit applied,
      // amountDue === price_amount and this is the pre-credits behaviour
      // exactly. confirm_paymongo_booking_payment() expects this same
      // figure (price_amount - credit_amount_applied), so the two agree by
      // construction rather than by coincidence.
      chargeAmountOverride: amountDue,
      // PayMongo adds the fee to this line item itself; processing_fee_amount
      // above is our prediction of what it will add, which is what makes the
      // webhook's amount check match.
      passOnFees,
      marketplaceSplit: marketplaceSplit && {
        platformFeeAmount: marketplaceSplit.platformFeeAmount,
        venuePaymongoAccountId: marketplaceSplit.venuePaymongoAccountId,
      },
    });

    await attachPaymongoCheckoutSession(supabase, booking.id, session.id);

    return { url: session.url, bookingId: booking.id, creditApplied, amountDue };
  } catch (error) {
    // The booking was created but something after it failed — release the
    // slot rather than leaving an unpayable pending booking behind. This
    // also returns any credit already applied: cancelling a pending booking
    // fires the restore trigger, so a failure here never strands a wallet
    // debit against a booking that won't happen.
    if (bookingId) {
      try {
        await cancelBooking(supabase, userId, bookingId);
      } catch (cleanupError) {
        logServerError("checkout.cleanupFailedPendingBooking", cleanupError);
      }
    }
    throw error;
  }
}

/** Logs the failure and returns the customer-safe message both checkout
 * entry points show. PayMongoError.message is customer-safe by
 * construction (the deployment detail lives on .detail) — see
 * lib/services/paymongo.ts. */
export function describeCheckoutError(error: unknown): string {
  if (error instanceof BookingError || error instanceof PayMongoError) {
    logServerError(`checkout.${error.reason}`, error);
    return error.message;
  }
  logServerError("checkout.createSession", error);
  return getFriendlyErrorMessage(error, "We couldn't start checkout.");
}
