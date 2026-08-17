import { PROCESSING_FEE_PERCENT } from "@/lib/booking-config";

export type BookingCharge = {
  /** The court price the venue is owed against — unchanged by this calculation. */
  courtAmount: number;
  /** What the customer pays on top, to cover PayMongo's cut. */
  processingFeeAmount: number;
  /** What PayMongo is actually asked to charge: courtAmount + processingFeeAmount. */
  totalChargedAmount: number;
};

/**
 * Works out what to charge a customer so that, after PayMongo takes its
 * cut, AIR/Rally is left holding the full court price.
 *
 * The fee is GROSSED UP, not simply added, and that distinction is the
 * whole point of this module. PayMongo's rate applies to the total amount
 * charged, not to the court price — so adding a flat 1.5008% of the court
 * price under-collects every time:
 *
 *   naive:    charge 400 + 6.00 = 406.00 -> PayMongo takes 1.5008% of
 *             406.00 = 6.09 -> AIR/Rally nets 399.91. Short by 0.09.
 *
 *   grossed:  charge 400 / (1 - 0.015008) = 406.10 -> PayMongo takes
 *             1.5008% of 406.10 = 6.09 -> AIR/Rally nets 400.01. Whole.
 *
 * The shortfall is small per booking and structural across all of them,
 * which is exactly the kind of leak that is invisible until it is
 * reconciled against a bank statement months later.
 *
 * Integer minor units (centavos) throughout, same discipline as
 * lib/services/commission.ts: one rounding step, applied to the total,
 * with the fee derived as the remainder so the three numbers always
 * satisfy courtAmount + processingFeeAmount === totalChargedAmount
 * exactly. Deriving the fee independently and adding it would let a
 * rounding step land in both terms and produce a total a centavo off.
 *
 * Rounds the total UP (ceil): a fractional centavo that rounded down
 * would leave AIR/Rally paying the difference, and a centavo is not worth
 * a discrepancy in a payment reconciliation.
 */
export function calculateBookingCharge(courtAmountMinorUnits: number): BookingCharge {
  if (!Number.isInteger(courtAmountMinorUnits) || courtAmountMinorUnits < 0) {
    throw new Error(`courtAmount must be a non-negative integer in minor units, got ${courtAmountMinorUnits}`);
  }

  // A zero-price court can't be charged, and dividing it through the
  // gross-up would still be zero — return early rather than imply a fee.
  if (courtAmountMinorUnits === 0) {
    return { courtAmount: 0, processingFeeAmount: 0, totalChargedAmount: 0 };
  }

  const totalChargedAmount = Math.ceil(courtAmountMinorUnits / (1 - PROCESSING_FEE_PERCENT));
  const processingFeeAmount = totalChargedAmount - courtAmountMinorUnits;

  return { courtAmount: courtAmountMinorUnits, processingFeeAmount, totalChargedAmount };
}
