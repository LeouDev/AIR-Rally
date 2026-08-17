/**
 * What a booking's payment is actually doing, as opposed to what its status
 * column says.
 *
 * `status = 'pending'` covers two situations that need opposite screens, and
 * conflating them is why the confirmation page told everyone "your payment is
 * being confirmed":
 *
 *   - SETTLING: money left the customer, the webhook has not landed yet.
 *     Seconds, self-resolving, and the right response is to wait.
 *
 *   - AWAITING_PAYMENT: checkout was opened and abandoned. Nothing was
 *     charged, nothing is in flight, and no amount of waiting will change it.
 *
 * `paid_at` alone used to be the discriminator (null = never paid), but
 * `paid_at` is only ever written in the SAME update that confirms a
 * booking — so by the time it's non-null, status is already 'confirmed'
 * and this function never even reaches the pending branch on it. That made
 * SETTLING unreachable: every pending booking looked like the abandoned
 * kind, even one where the customer had just paid seconds ago and the
 * webhook simply hadn't landed. `paymentInFlight` is the fix — a live
 * signal from reconcilePaymongoPendingBooking() (see
 * lib/services/bookings.ts), not anything stored on the booking row —
 * for "PayMongo shows an attempt that hasn't resolved yet, so this might
 * still be settling" as opposed to "nothing was ever attempted."
 */
export type PaymentState = "confirmed" | "cancelled" | "settling" | "awaiting_payment";

export function derivePaymentState(
  booking: {
    status: "pending" | "confirmed" | "cancelled";
    paid_at: string | null;
  },
  options?: { paymentInFlight?: boolean }
): PaymentState {
  if (booking.status === "confirmed") return "confirmed";
  if (booking.status === "cancelled") return "cancelled";
  if (booking.paid_at !== null || options?.paymentInFlight) return "settling";
  return "awaiting_payment";
}

/**
 * Whether this booking was settled entirely from AIR/Rally Credits.
 *
 * These never had a PayMongo session — they confirm through
 * confirm_credit_only_booking() — so any copy about e-wallets, banks, or
 * re-checking with PayMongo is wrong for them, and their
 * processing_fee_amount of 0 is correct rather than missing.
 */
export function isCreditOnly(booking: { payment_provider: string }): boolean {
  return booking.payment_provider === "air_rally_credit";
}
