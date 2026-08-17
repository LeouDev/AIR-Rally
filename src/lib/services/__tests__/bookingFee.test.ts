import { calculateBookingCharge } from "../bookingFee";
import { PROCESSING_FEE_PERCENT } from "@/lib/booking-config";

describe("calculateBookingCharge", () => {
  it("grosses up a ₱400 court to ₱406.10, the worked example from the brief", () => {
    expect(calculateBookingCharge(40000)).toEqual({
      courtAmount: 40000,
      processingFeeAmount: 610,
      totalChargedAmount: 40610,
    });
  });

  it("leaves AIR/Rally whole after PayMongo takes its cut — the property the whole module exists for", () => {
    // The real test: charge the customer, let PayMongo take its rate off
    // the TOTAL, and check what's left still covers the court price.
    for (const court of [8000, 9000, 10000, 12000, 15000, 20000, 40000, 123456]) {
      const { totalChargedAmount } = calculateBookingCharge(court);
      const paymongoTakes = totalChargedAmount * PROCESSING_FEE_PERCENT;
      const netToPlatform = totalChargedAmount - paymongoTakes;
      expect(netToPlatform).toBeGreaterThanOrEqual(court);
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
    expect(calculateBookingCharge(9000).totalChargedAmount).toBe(9138);
    expect(calculateBookingCharge(10000).totalChargedAmount).toBe(10153);
    expect(calculateBookingCharge(12000).totalChargedAmount).toBe(12183);
    expect(calculateBookingCharge(15000).totalChargedAmount).toBe(15229);
    expect(calculateBookingCharge(20000).totalChargedAmount).toBe(20305);
  });
});
