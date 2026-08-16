import { PLATFORM_FEE_PERCENT } from "@/lib/booking-config";

export type MarketplaceSplit = {
  /** AIR/Rally's 5% share, integer minor units. */
  platformFeeAmount: number;
  /** The venue's 95% share, integer minor units. */
  venueAmount: number;
};

/**
 * The one authoritative place the 95%/5% split is computed — called from
 * exactly one place (createBooking-adjacent checkout flow, before any
 * PayMongo API call), never recomputed elsewhere. Integer arithmetic
 * only, no floats: platformFeeAmount is rounded once, venueAmount is
 * always the remainder by subtraction (never separately rounded), so the
 * two are guaranteed to sum exactly to grossAmount for every input —
 * this is a property of the arithmetic itself, not something that needs
 * a runtime assertion.
 */
export function calculateMarketplaceSplit(grossAmountMinorUnits: number): MarketplaceSplit {
  const platformFeeAmount = Math.round(grossAmountMinorUnits * PLATFORM_FEE_PERCENT);
  const venueAmount = grossAmountMinorUnits - platformFeeAmount;
  return { platformFeeAmount, venueAmount };
}
