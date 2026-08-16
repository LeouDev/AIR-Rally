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
