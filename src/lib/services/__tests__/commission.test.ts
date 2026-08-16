import { calculateMarketplaceSplit } from "../commission";

describe("calculateMarketplaceSplit", () => {
  it.each([
    [50000, 2500, 47500], // ₱500.00
    [100000, 5000, 95000], // ₱1,000.00
    [200000, 10000, 190000], // ₱2,000.00
    [500000, 25000, 475000], // ₱5,000.00
    [1, 0, 1], // ₱0.01 — 5% rounds to 0, never an error
    [9999, 500, 9499], // an odd amount
    [0, 0, 0],
  ])("splits %i into platformFeeAmount=%i, venueAmount=%i", (gross, expectedFee, expectedVenue) => {
    const { platformFeeAmount, venueAmount } = calculateMarketplaceSplit(gross);
    expect(platformFeeAmount).toBe(expectedFee);
    expect(venueAmount).toBe(expectedVenue);
  });

  it("always sums exactly to the gross amount — the venue's share is never separately rounded", () => {
    for (let gross = 0; gross <= 200000; gross += 137) {
      const { platformFeeAmount, venueAmount } = calculateMarketplaceSplit(gross);
      expect(platformFeeAmount + venueAmount).toBe(gross);
      expect(Number.isInteger(platformFeeAmount)).toBe(true);
      expect(Number.isInteger(venueAmount)).toBe(true);
    }
  });
});
