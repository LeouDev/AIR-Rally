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
 * What the customer actually parted with for a booking, in integer minor
 * units — the figure a receipt should show.
 *
 * price_amount alone is NOT that figure once fees are passed on. A ₱800
 * court with a ₱12.18 passed-on fee is an ₱812.18 charge, and showing
 * ₱800.00 under "Amount paid" under-reports a real payment. Observed live:
 * booking 9F50AD9F was charged ₱812.18 and its confirmation page read
 * ₱800.00.
 *
 * credit_amount_applied is deliberately NOT subtracted. Credit is payment,
 * not a discount — a booking settled half in credit still cost the
 * customer its full price, just from two sources. Subtracting it here
 * would under-report in the opposite direction. The figure that varies by
 * funding source is what PayMongo collected, which is a different
 * question from what the booking cost.
 *
 * Bookings made before the fee was passed on, and every booking made while
 * the gate is off, carry processing_fee_amount = 0 — so this returns
 * price_amount exactly, and their receipts are unchanged.
 */
export function calculateAmountPaid(booking: { price_amount: number; processing_fee_amount: number }): number {
  return booking.price_amount + booking.processing_fee_amount;
}

/**
 * How much credit a cancelled booking is refunded: the court price ONLY,
 * never the processing fee.
 *
 * This is deliberately NOT calculateAmountPaid(). The customer paid
 * price + fee, but the fee was consumed by PayMongo at the moment the
 * payment was processed — AIR/Rally never held it and cannot return it.
 * Refunding it would mean paying PayMongo's fee twice out of the 5%
 * commission: once when the booking was made, again as credit.
 *
 * What stops this shortchanging the customer is that credit does not
 * attract a fee when it is spent. A ₱500 refund covers a ₱500 court in
 * full, and a fully credit-covered booking never creates a PayMongo
 * checkout session at all, so no second fee is charged. See
 * lib/actions/checkout.ts, which grosses up the POST-credit amount for
 * exactly this reason.
 *
 * Be precise about what that does and does not mean: the customer is not
 * made whole on the original fee. They paid ₱525 and can rebook ₱500 of
 * court. The fee is a real cost of the cancelled transaction, and this
 * rule places it with the customer rather than with AIR/Rally. That is a
 * business decision, recorded here so nobody "fixes" it into
 * calculateAmountPaid() later.
 *
 * calculateAmountPaid() remains the right figure for a RECEIPT, which is
 * a factual statement of what was charged. These two must never be
 * conflated, which is why they are separate functions with separate
 * names rather than one function with a flag.
 */
export function calculateRefundCredit(booking: { price_amount: number }): number {
  return booking.price_amount;
}

/**
 * Every money figure on a booking, separated and named, so that callers
 * never re-derive one of them slightly differently.
 *
 * The four are genuinely distinct and the differences only show up on
 * bookings that used credit — which is exactly where a wrong figure looks
 * like a bug rather than an error:
 *
 *   courtPrice        what the venue is owed against; the refundable base
 *   processingFee     PayMongo's cut, passed to the customer, non-refundable
 *   creditApplied     settled from the wallet, so never sent to PayMongo
 *   payableToProvider what PayMongo was actually asked to collect
 *   totalPaid         what the customer parted with, from both sources
 *
 * payableToProvider is the figure confirm_paymongo_booking_payment()
 * checks a real payment against, so it must stay
 * price - credit + fee exactly; see migration 20260810000054.
 */
export type BookingAmounts = {
  courtPrice: number;
  processingFee: number;
  creditApplied: number;
  payableToProvider: number;
  totalPaid: number;
  refundableAsCredit: number;
};

export function describeBookingAmounts(booking: {
  price_amount: number;
  processing_fee_amount: number;
  credit_amount_applied: number;
}): BookingAmounts {
  return {
    courtPrice: booking.price_amount,
    processingFee: booking.processing_fee_amount,
    creditApplied: booking.credit_amount_applied,
    payableToProvider: booking.price_amount - booking.credit_amount_applied + booking.processing_fee_amount,
    totalPaid: calculateAmountPaid(booking),
    refundableAsCredit: calculateRefundCredit(booking),
  };
}

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
 * Rounds to NEAREST, not up — deliberately, and at a small cost.
 * Rounding up would occasionally leave AIR/Rally a centavo better off,
 * but PayMongo rounds to nearest, and this number's job is to predict
 * theirs exactly so the amount-integrity check matches. Where the two
 * disagree the booking does not confirm at all, which is worth far more
 * than a centavo. The consequence is that on some prices AIR/Rally
 * absorbs up to one centavo of the fee; that is the accepted trade for
 * confirmations that work.
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

  const totalChargedAmount = Math.round(courtAmountMinorUnits / (1 - PROCESSING_FEE_PERCENT));
  const processingFeeAmount = totalChargedAmount - courtAmountMinorUnits;

  return { courtAmount: courtAmountMinorUnits, processingFeeAmount, totalChargedAmount };
}
