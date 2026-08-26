/**
 * The provider's per-transfer fee, in CENTAVOS. 1000 = ₱10.00.
 *
 * ⚠️ THIS VALUE IS UNVERIFIED AND DISPUTED BY PAYMONGO'S OWN DOCUMENTATION.
 * DO NOT TREAT ₱10 AS SETTLED, AND DO NOT DEDUCT IT FROM A VENUE UNTIL IT IS.
 *
 * Three PayMongo sources disagree (checked August 2026):
 *   - paymongo.com/pricing:  "₱10 per transaction (via InstaPay or PesoNET)"
 *   - paymongo.com/financial-services/wallet:  "Standard bank transfers via
 *     PESONet are free, while InstaPay transfers have a small fee per
 *     transaction" — and, of batch disbursements, "for free"
 *   - Money Movement API docs: a worked example showing an ₱8.00 fee
 *
 * AIR/Rally sends via PESONet (see pesonetBanks.ts), which is the rail the
 * wallet page calls free. If that is right, deducting ₱10 from a venue
 * charges them for a cost we never incur — and the draft Owner Agreement
 * clause 3.10 would be a false statement in a signed document.
 *
 * Awaiting PayMongo support and, more usefully, the first real transfer:
 * whatever their statement shows deducted is the answer for the rail we
 * actually use. Until then this stays at 1000 because changing it would be
 * a different guess, not a correction. Nothing has been deducted from
 * anyone — zero payout_transfers rows exist.
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
