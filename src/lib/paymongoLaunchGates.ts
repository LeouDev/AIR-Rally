/**
 * Hard production-safety kill-switch for PayMongo Platforms marketplace
 * splitting — deliberately independent of any individual venue's
 * `paymongo_activation_status`. Even if a venue row is somehow marked
 * "activated" (a manual DB fix, a future bug, a support action), this
 * module is the one place that decides whether `split_payment` is ever
 * allowed to be attached to a real checkout session.
 *
 * `ACTIVE_PAYMENT_PROVIDER=paymongo` alone is NOT enough to enable
 * marketplace splitting — that var only controls the *plain*, non-split
 * PayMongo checkout flow, which has already been verified working
 * end-to-end (see ARCHITECTURE.md's "PayMongo TEST MODE" section). A
 * second, separate, explicit opt-in is required specifically for the
 * marketplace split, so that flipping one env var by mistake can never
 * accidentally activate unverified two-party splitting.
 *
 * See ARCHITECTURE.md's "PayMongo Platforms" section and the PayMongo
 * Final Verification Report for exactly which launch gates remain
 * unproven (a genuine two-account split, two-party refund accounting,
 * the production fee schedule, Child Merchant disabled/suspended
 * handling, and the production KYC/onboarding flow) — this module does
 * not re-derive that list, it only enforces that none of it can leak
 * into a real checkout by accident.
 */
export function isPaymongoMarketplaceSplitEnabled(): boolean {
  return process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED === "true";
}

/**
 * Hard kill-switch for lib/services/refunds.ts's PayMongo refund
 * execution path — separate from the split-enable flag above, since
 * refund accounting for a two-party split is unproven even independently
 * of whether splitting itself is enabled.
 */
export function isPaymongoRefundExecutionEnabled(): boolean {
  return process.env.PAYMONGO_REFUND_EXECUTION_ENABLED === "true";
}

/**
 * Adds PayMongo's processing fee to the customer's checkout total instead
 * of AIR/Rally absorbing it out of the 5% commission. Measured against a
 * real live payment: an ₱80 QR Ph booking was charged ₱1.20 (1.34% base
 * plus 12% VAT = 1.5008%), so ₱1.20 of a ₱4.00 commission — 30% of
 * margin — was going to PayMongo on every booking.
 *
 * Gated, and OFF by default, for one specific unresolved reason. PayMongo
 * confirmed in writing that with `pass_on_fees: true` the *Payment
 * Intent* keeps the original booking amount, which is what keeps the
 * 5%/95% split intact. But confirm_paymongo_booking_payment()'s
 * amount-integrity check reads the *Payment* object's amount, a different
 * resource, and whether that one reports ₱80.00 or ₱81.22 has not been
 * observed. If it reports the grossed-up figure, the check matches zero
 * rows and NO booking ever confirms — customers pay and sit on "pending",
 * exactly the outage this project already had once from the webhook
 * signature bug.
 *
 * So: enable this in a preview/test deployment first, put one booking
 * through, and confirm it reaches 'confirmed'. Only then set it in
 * production. Do not flip it straight to production on the strength of
 * the email alone — the email describes the Payment Intent, and the code
 * checks the Payment.
 */
export function isPaymongoPassOnFeesEnabled(): boolean {
  return process.env.PAYMONGO_PASS_ON_FEES_ENABLED === "true";
}
