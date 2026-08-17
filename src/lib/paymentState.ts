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
 * Every pending booking in production today is the second kind. Telling those
 * customers their payment is being confirmed is false, and it strands them on
 * a page whose only control re-checks a payment that does not exist.
 *
 * `paid_at` is the discriminator: null means no payment was ever recorded.
 */
export type PaymentState = "confirmed" | "cancelled" | "settling" | "awaiting_payment";

export function derivePaymentState(booking: {
  status: "pending" | "confirmed" | "cancelled";
  paid_at: string | null;
}): PaymentState {
  if (booking.status === "confirmed") return "confirmed";
  if (booking.status === "cancelled") return "cancelled";
  return booking.paid_at === null ? "awaiting_payment" : "settling";
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
