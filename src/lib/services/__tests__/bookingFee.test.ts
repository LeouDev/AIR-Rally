import { calculateBookingCharge, calculateAmountPaid, calculateRefundCredit, describeBookingAmounts } from "../bookingFee";
import { PROCESSING_FEE_PERCENT } from "@/lib/booking-config";

describe("calculateBookingCharge", () => {
  it("reproduces PayMongo's own charge exactly: a ₱400 court becomes ₱406.09", () => {
    // Observed on a real pass_on_fees checkout — PayMongo billed ₱406.09.
    // This assertion is the contract: if it drifts, confirmations break.
    expect(calculateBookingCharge(40000)).toEqual({
      courtAmount: 40000,
      processingFeeAmount: 609,
      totalChargedAmount: 40609,
    });
  });

  it("leaves AIR/Rally whole after PayMongo takes its cut — the property the whole module exists for", () => {
    // The real test: charge the customer, let PayMongo take its rate off
    // the TOTAL, and check what's left still covers the court price.
    for (const court of [8000, 9000, 10000, 12000, 15000, 20000, 40000, 123456]) {
      const { totalChargedAmount } = calculateBookingCharge(court);
      const paymongoTakes = totalChargedAmount * PROCESSING_FEE_PERCENT;
      const netToPlatform = totalChargedAmount - paymongoTakes;
      // Within a centavo: matching PayMongo's round-to-nearest means the
      // platform absorbs up to ₱0.01 on some prices. Deliberate — see
      // bookingFee.ts. Rounding up instead would break confirmation.
      expect(netToPlatform).toBeGreaterThanOrEqual(court - 1);
    }
  });

  it("would NOT stay whole under a naive additive fee — proving the gross-up is necessary", () => {
    const court = 40000;
    const naiveTotal = court + Math.round(court * PROCESSING_FEE_PERCENT); // 40600
    const netUnderNaive = naiveTotal - naiveTotal * PROCESSING_FEE_PERCENT;
    expect(netUnderNaive).toBeLessThan(court); // short — this is the bug being avoided
  });

  it("always satisfies court + fee === total exactly, with no rounding drift", () => {
    for (let court = 1; court <= 3000; court += 7) {
      const c = calculateBookingCharge(court);
      expect(c.courtAmount + c.processingFeeAmount).toBe(c.totalChargedAmount);
    }
  });

  it("never returns a negative or fractional fee", () => {
    for (const court of [1, 50, 99, 100, 8000, 999999]) {
      const c = calculateBookingCharge(court);
      expect(Number.isInteger(c.processingFeeAmount)).toBe(true);
      expect(c.processingFeeAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it("charges nothing on a zero-price court rather than inventing a fee", () => {
    expect(calculateBookingCharge(0)).toEqual({ courtAmount: 0, processingFeeAmount: 0, totalChargedAmount: 0 });
  });

  it("rejects non-integer or negative input instead of silently producing centavo dust", () => {
    expect(() => calculateBookingCharge(80.5)).toThrow(/minor units/);
    expect(() => calculateBookingCharge(-100)).toThrow(/minor units/);
  });

  it("matches the live court prices on the venue used for UAT", () => {
    // ₱80 / ₱90 / ₱100 / ₱120 / ₱150 / ₱200 — the six real courts.
    expect(calculateBookingCharge(8000).totalChargedAmount).toBe(8122);
    expect(calculateBookingCharge(9000).totalChargedAmount).toBe(9137);
    expect(calculateBookingCharge(10000).totalChargedAmount).toBe(10152);
    expect(calculateBookingCharge(12000).totalChargedAmount).toBe(12183);
    expect(calculateBookingCharge(15000).totalChargedAmount).toBe(15228);
    expect(calculateBookingCharge(20000).totalChargedAmount).toBe(20305);
  });
});

describe("calculateAmountPaid", () => {
  it("adds the passed-on fee to the court price", () => {
    // The live case this fixes: booking 9F50AD9F was charged ₱812.18 and
    // its confirmation page read ₱800.00.
    expect(calculateAmountPaid({ price_amount: 80000, processing_fee_amount: 1218 })).toBe(81218);
  });

  it("agrees with what calculateBookingCharge told PayMongo to collect", () => {
    // The two must not drift: one decides the charge, the other reports it.
    for (const court of [8000, 40000, 80000, 150000]) {
      const charge = calculateBookingCharge(court);
      expect(calculateAmountPaid({ price_amount: court, processing_fee_amount: charge.processingFeeAmount })).toBe(charge.totalChargedAmount);
    }
  });

  it("leaves pre-fee bookings reading exactly their price", () => {
    // Every booking made before the pass-through, and every booking made
    // while the gate is off, carries a zero fee.
    expect(calculateAmountPaid({ price_amount: 40000, processing_fee_amount: 0 })).toBe(40000);
  });

  it("counts credit as payment rather than subtracting it", () => {
    // A booking settled partly from the wallet still cost the customer its
    // full price — from two sources. credit_amount_applied is deliberately
    // not a parameter here, so it cannot be subtracted by accident.
    expect(calculateAmountPaid({ price_amount: 50000, processing_fee_amount: 0 })).toBe(50000);
  });
});

describe("calculateRefundCredit — refunds never include the processing fee", () => {
  /** The worked example from the business rule: ₱500 court, ₱25 fee, ₱525 charged. */
  const WORKED_EXAMPLE = { price_amount: 50000, processing_fee_amount: 2500, credit_amount_applied: 0 };

  it("refunds the court price only, not the total charged", () => {
    expect(calculateRefundCredit(WORKED_EXAMPLE)).toBe(50000);
    // The customer was charged ₱525; the refund is ₱500.
    expect(calculateAmountPaid(WORKED_EXAMPLE)).toBe(52500);
  });

  it("never returns more than the court price, at any fee size", () => {
    // THE POINT OF THIS TEST: the fee must never leak into a refund. If
    // someone "fixes" calculateRefundCredit() to use calculateAmountPaid(),
    // every one of these fails.
    for (const court of [8000, 40000, 80000, 120000, 160000]) {
      const { processingFeeAmount } = calculateBookingCharge(court);
      expect(processingFeeAmount).toBeGreaterThan(0);
      expect(calculateRefundCredit({ price_amount: court })).toBe(court);
      expect(calculateRefundCredit({ price_amount: court })).toBeLessThan(calculateAmountPaid({ price_amount: court, processing_fee_amount: processingFeeAmount }));
    }
  });

  it("is unaffected by how the booking was funded", () => {
    // Credit-funded or card-funded, the venue was owed the same court price
    // and that is what comes back.
    expect(calculateRefundCredit({ price_amount: 50000 })).toBe(50000);
    expect(describeBookingAmounts({ price_amount: 50000, processing_fee_amount: 2500, credit_amount_applied: 20000 }).refundableAsCredit).toBe(50000);
  });

  it("refunds the full price on a pre-fee booking, where fee is 0", () => {
    expect(calculateRefundCredit({ price_amount: 40000 })).toBe(40000);
    expect(calculateAmountPaid({ price_amount: 40000, processing_fee_amount: 0 })).toBe(40000);
  });
});

describe("describeBookingAmounts — the four figures stay separate", () => {
  it("separates court price, fee, credit and what the provider was asked for", () => {
    // ₱500 court, ₱200 of credit, so PayMongo collects ₱300 plus ₱300's fee.
    const fee = calculateBookingCharge(30000).processingFeeAmount;
    const a = describeBookingAmounts({ price_amount: 50000, processing_fee_amount: fee, credit_amount_applied: 20000 });

    expect(a.courtPrice).toBe(50000);
    expect(a.creditApplied).toBe(20000);
    expect(a.processingFee).toBe(fee);
    // What the webhook's amount check compares against — must stay exactly
    // price - credit + fee (migration 20260810000054).
    expect(a.payableToProvider).toBe(50000 - 20000 + fee);
    expect(a.totalPaid).toBe(50000 + fee);
    expect(a.refundableAsCredit).toBe(50000);
  });

  it("agrees with what checkout actually asks PayMongo to collect", () => {
    // Requirement 3: the fee is charged only on the remaining balance, so a
    // booking's fee is its POST-credit amount's fee, never the full price's.
    const courtPrice = 50000;
    const credit = 20000;
    const remaining = courtPrice - credit;
    const charge = calculateBookingCharge(remaining);

    const a = describeBookingAmounts({ price_amount: courtPrice, processing_fee_amount: charge.processingFeeAmount, credit_amount_applied: credit });
    expect(a.payableToProvider).toBe(charge.totalChargedAmount);
    // And the fee is strictly smaller than it would have been on the full price.
    expect(a.processingFee).toBeLessThan(calculateBookingCharge(courtPrice).processingFeeAmount);
  });

  it("charges no fee at all when credit covers the whole booking", () => {
    // A fully covered booking never reaches PayMongo, so there is no fee to
    // pass on — which is what makes a court-price-only refund whole.
    const a = describeBookingAmounts({ price_amount: 50000, processing_fee_amount: 0, credit_amount_applied: 50000 });
    expect(a.payableToProvider).toBe(0);
    expect(a.processingFee).toBe(0);
    // A ₱500 refund buys a ₱500 court outright, with no new fee.
    expect(calculateRefundCredit({ price_amount: 50000 })).toBe(a.courtPrice);
  });
});
