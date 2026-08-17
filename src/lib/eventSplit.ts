/**
 * The share calculator for an Open Play game.
 *
 * AIR/Rally does NOT collect these shares. One person books and pays the
 * venue; this only tells the group what an even split would be, so nobody
 * has to do arithmetic in a group chat. How — and whether — they settle up
 * is entirely between the players.
 *
 * The organiser is always counted as a player. They're on the court too,
 * and a split that quietly excluded them would overcharge everyone else.
 */

export type SplitBreakdown = {
  /** Total the organiser paid the venue, in integer minor units. */
  totalAmount: number;
  /** Everyone on the roster, organiser included. Never below 1. */
  playerCount: number;
  /** Rounded to the centavo. */
  sharePerPlayer: number;
  /**
   * What the organiser is left carrying once everyone else pays their
   * share exactly. Zero when the total divides evenly; a few centavos
   * otherwise. Never hidden — it is the organiser who absorbs it.
   */
  organiserRemainder: number;
};

/**
 * Integer arithmetic only, matching every other money path in the app.
 * The share is rounded UP so the collected shares can never total less
 * than the bill — any rounding difference lands on the organiser as a
 * small credit rather than leaving the group short.
 */
export function calculateSplit(totalAmount: number, playerCount: number): SplitBreakdown {
  const players = Math.max(1, Math.floor(playerCount));
  const total = Math.max(0, Math.round(totalAmount));

  const sharePerPlayer = Math.ceil(total / players);
  // What the organiser effectively bears: their own share plus (or minus)
  // whatever rounding leaves over once the others pay theirs.
  const collectedFromOthers = sharePerPlayer * (players - 1);
  const organiserRemainder = total - collectedFromOthers;

  return { totalAmount: total, playerCount: players, sharePerPlayer, organiserRemainder };
}

/** ₱1,234.50 — same convention as the settlement views. */
export function formatShare(amountMinorUnits: number, currency = "PHP"): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The line shown while a roster is still being assembled: what each person
 * pays now, and what they'd pay if everyone invited actually joins.
 * Confirmed players are what matters today; the target is context.
 */
export function describeSplit(params: {
  totalAmount: number;
  confirmedPlayers: number;
  targetPlayers: number;
  currency?: string;
}): { now: string; whenFull: string | null } {
  const { totalAmount, confirmedPlayers, targetPlayers, currency = "PHP" } = params;
  const now = calculateSplit(totalAmount, confirmedPlayers);

  if (targetPlayers <= confirmedPlayers) {
    return { now: `${formatShare(now.sharePerPlayer, currency)} each`, whenFull: null };
  }

  const full = calculateSplit(totalAmount, targetPlayers);
  return {
    now: `${formatShare(now.sharePerPlayer, currency)} each`,
    whenFull: `${formatShare(full.sharePerPlayer, currency)} each with ${targetPlayers}`,
  };
}
