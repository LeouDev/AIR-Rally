import { calculateBookingCharge, calculateAmountPaid } from "../bookingFee";
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
