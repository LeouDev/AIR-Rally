/**
 * The provider's per-transfer fee, in CENTAVOS. 1000 = ₱10.00.
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
