/**
 * The provider's per-transfer fee, in CENTAVOS. 1000 = ₱10.00.
 *
 * VERIFIED BY OBSERVATION, 2026-08-26: the founder made real transfers on
 * their own PayMongo account and ₱10 was charged on BOTH PESONet and
 * InstaPay. That is the rail we actually use, on the actual account, so it
 * settles the question.
 *
 * ⚠️ PAYMONGO'S OWN WALLET PAGE CONTRADICTS THIS AND IS WRONG. Recorded so
 * that a future reader who finds it does not re-open a closed question:
 *   - paymongo.com/pricing — "₱10 per transaction (via InstaPay or PesoNET)"
 *     ✅ matches observed behaviour
 *   - paymongo.com/financial-services/wallet — "Standard bank transfers via
 *     PESONet are free", and of batch disbursements "for free"
 *     ❌ contradicted by a live transfer; do not trust this page on fees
 *   - Money Movement API docs — a worked example showing ₱8.00
 *     ❌ an example figure, not a rate
 *
 * The disagreement was worth chasing even though it confirmed the number
 * rather than changing it: had PESONet been free, deducting ₱10 would have
 * charged a venue for a cost never incurred, and Owner Agreement clause
 * 3.10 would have been a false statement in a signed document.
 *
 * MIRRORS `public.payout_transfer_fee_centavos()` (migration
 * 20260810000092). The database is the source of truth — every real
 * transfer row gets its `provider_fee` from that function, never from
 * here. This constant exists only for surfaces that need the figure
 * BEFORE a transfer row exists, which today is the payslip preview.
 *
 * If the fee ever changes, change the SQL function first and this second.
 * A real payslip will always show the stored `provider_fee` from the row;
 * only a preview can disagree, and a preview disagreeing is a cosmetic
 * problem rather than a money one.
 *
 * CENTAVOS, NOT PESOS. Writing 10 here would mean ten centavos — a silent
 * 100x error in the one place nobody looks twice, because "10" matches the
 * "₱10" in the owner agreement. Money is stored in centavos throughout this
 * schema: a ₱400.00 booking is 40000, verified against production data and
 * against the agreement's own §3.2 worked example.
 */
export const PAYOUT_TRANSFER_FEE_CENTAVOS = 1000;

export function payoutTransferFeeCentavos(): number {
  return PAYOUT_TRANSFER_FEE_CENTAVOS;
}
