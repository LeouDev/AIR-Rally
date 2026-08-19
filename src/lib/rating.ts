import type { RankedMatchType } from "@/lib/supabase/types";

/**
 * The DUPR-inspired rating engine's pure math — a preview/mirror layer,
 * not the authority. `apply_ranked_result()` in
 * supabase/migrations/20260810000068_dupr_rating_engine.sql is where a
 * rating actually changes; every function here is a read-only
 * re-implementation of a piece of that SQL, kept in lockstep by
 * scripts/verify-ranked-rating-engine.ts (which asserts the two agree on
 * a spread of sample inputs). This mirrors exactly how
 * `partyEligibility()` in lib/ranked.ts already relates to
 * `create_ranked_match()`'s spread check — a fast, Jest-testable preview
 * the database re-checks and is free to reject regardless of what this
 * file says.
 *
 * This is AIR/Rally's own approximation of DUPR's publicly documented
 * *behavior* (performance-vs-expectation, score-margin-aware, match type
 * and recency matter, confidence grows with volume) — not a claim of
 * DUPR's actual proprietary formula, which is not public.
 */

/** Everyone starts here on the new scale. Matches `player_ranks.rating`'s default in the migration. */
export const RATING_STARTING_VALUE = 1000;

/**
 * The seven-rank ladder, low to high. Order is load-bearing — `tier` is
 * the index the database stores (1-7), so this must never be reordered.
 * Dinker's band is 1000 AAR wide; every other rank is 200 wide, capped
 * at Champion (open-ended above 2000 for rating purposes, but its STAR
 * band still caps at 2199 — see `rankForAar`).
 */
export const RANK_THRESHOLDS = [
  { tier: 1, slug: "dinker", name: "Dinker", material: "#c2ad8b", floor: 0, width: 1000 },
  { tier: 2, slug: "driver", name: "Driver", material: "#d9903a", floor: 1000, width: 200 },
  { tier: 3, slug: "volleyer", name: "Volleyer", material: "#f3700f", floor: 1200, width: 200 },
  { tier: 4, slug: "smasher", name: "Smasher", material: "#f3700f", floor: 1400, width: 200 },
  { tier: 5, slug: "ace", name: "Ace", material: "#f3700f", floor: 1600, width: 200 },
  { tier: 6, slug: "kitchen-king", name: "Kitchen King", material: "#f3700f", floor: 1800, width: 200 },
  { tier: 7, slug: "champion", name: "Champion", material: "#f3700f", floor: 2000, width: Infinity },
] as const;

export const RATING_TIER_COUNT = RANK_THRESHOLDS.length;

export type RatingTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RatingStar = 1 | 2 | 3 | 4 | 5;

const STARS_PER_RANK = 5;

/**
 * Stateless rank+star from a raw AAR value — the only thing that decides
 * a displayed rank. Mirrors `ranked_rank_for_aar()` in the migration
 * exactly, including Champion's star band capping at floor+199 (2199)
 * even though its rating band is open-ended: a rating past that keeps
 * climbing for leaderboard-sort purposes but stays "Champion ★★★★★" on
 * screen, the same ceiling treatment the previous 8-tier build gave its
 * top tier.
 *
 * Star width is band width ÷ 5, applied uniformly — not a special case
 * for Dinker, just the same ratio (200/5=40 for the six 200-wide ranks,
 * 1000/5=200 for Dinker) the spec's own worked examples already imply.
 */
export function rankForAar(rating: number): { tier: RatingTier; star: RatingStar } {
  const band = RANK_THRESHOLDS.find((r) => rating < r.floor + r.width) ?? RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
  // Champion's rating band is open-ended, but its STAR band is capped at
  // floor+199 (2199) like every other 200-wide rank — 40 here, not the
  // Infinity-derived width, is what makes that cap kick in below.
  const starWidth = band.width === Infinity ? 200 / STARS_PER_RANK : band.width / STARS_PER_RANK;
  const offset = rating - band.floor;
  const star = Math.min(STARS_PER_RANK, Math.max(1, Math.floor(offset / starWidth) + 1)) as RatingStar;
  return { tier: band.tier as RatingTier, star };
}

export function rankName(tier: RatingTier): string {
  return RANK_THRESHOLDS[tier - 1].name;
}

/** Standard logistic Elo — divisor 400, both sides plain rating numbers (a team's "own rating" is the average of its players, computed by the caller). */
export function expectedScore(ownRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - ownRating) / 400));
}

/**
 * The point-share a team actually achieved — DUPR's margin-aware
 * "actual" term, replacing a strict win(1)/loss(0). An 11-9 win is a
 * much smaller actual score (0.55) than an 11-3 win (0.79); a 9-11 loss
 * (0.45) is a much better actual score than a 3-11 loss (0.21).
 */
export function actualPointShare(ownScore: number, opponentScore: number): number {
  const total = ownScore + opponentScore;
  return total === 0 ? 0.5 : ownScore / total;
}

export function performanceGap(actual: number, expected: number): number {
  return actual - expected;
}

export type MatchWeightType = "self_reported_rec" | "club" | "league" | "tournament" | "air_rally_ranked";

/**
 * AIR/Rally tuning parameters inspired by DUPR's public statement that
 * organized competitive matches carry more weight than self-reported
 * recreational ones — not a claim of DUPR's actual weights.
 */
export const MATCH_WEIGHTS: Record<MatchWeightType, number> = {
  self_reported_rec: 0.5,
  club: 1.0,
  league: 1.5,
  tournament: 2.0,
  air_rally_ranked: 1.5,
};

export function matchWeightFor(type: MatchWeightType): number {
  return MATCH_WEIGHTS[type];
}

/** Recency bands off match age in days — a match confirmed within minutes of being played (the normal case today) is always 1.00; this only bites once a delayed result (e.g. a resolved dispute) applies well after the fact. */
export function recencyMultiplier(daysOld: number): number {
  if (daysOld <= 29) return 1.0;
  if (daysOld <= 60) return 0.9;
  if (daysOld <= 90) return 0.8;
  if (daysOld <= 180) return 0.65;
  return 0.5;
}

/** AIR/Rally tuning parameters, not claimed DUPR values. Calibration moves fast and wide; established play is slower and narrower. */
export function kFactor(isCalibrated: boolean): number {
  return isCalibrated ? 40 : 80;
}

export function maxDelta(isCalibrated: boolean): number {
  return isCalibrated ? 60 : 120;
}

/**
 * 0-100 confidence in a player's current rating — NOT a measure of
 * skill. A 1700 AAR at reliability 25% means "we think you're around
 * 1700 but need more evidence"; the same 1700 at reliability 92% means
 * "we have strong evidence that's accurate." Grows with match volume on
 * a saturating curve (≈63% by 15 matches, ≈86% by 30), reduced by a
 * decay factor once a player has been away — reusing the same
 * 30/90/180-day breakpoints `recencyMultiplier` uses, since both are
 * answering a version of "how much has time eroded confidence in this
 * number." An AIR/Rally approximation, not a claimed DUPR formula.
 */
export function reliabilityFor(matchCount: number, daysSinceLastMatch: number | null): number {
  const volumeConfidence = 100 * (1 - Math.exp(-matchCount / 15));
  const decay =
    daysSinceLastMatch === null || daysSinceLastMatch <= 30
      ? 1.0
      : daysSinceLastMatch <= 90
        ? 0.85
        : daysSinceLastMatch <= 180
          ? 0.65
          : 0.45;
  return Math.min(100, Math.max(0, Math.round(volumeConfidence * decay)));
}

export type ReliabilityBand = "very-unstable" | "developing" | "moderate" | "reliable" | "highly-reliable";

export function reliabilityBand(reliability: number): ReliabilityBand {
  if (reliability <= 20) return "very-unstable";
  if (reliability <= 40) return "developing";
  if (reliability <= 60) return "moderate";
  if (reliability <= 80) return "reliable";
  return "highly-reliable";
}

/**
 * Damps volatility for a well-established rating without ever freezing
 * it solid — floors at 0.5 (half the normal swing) even at reliability
 * 100, because the system has to stay able to reflect real improvement
 * or decline. An AIR/Rally tuning choice, not a claimed DUPR formula.
 */
const RELIABILITY_STABILITY_FACTOR = 0.5;

export function reliabilityModifier(reliability: number): number {
  return 1 - (reliability / 100) * RELIABILITY_STABILITY_FACTOR;
}

/**
 * The full delta formula, matching `apply_ranked_result()`'s SQL
 * exactly: K × performanceGap × matchWeight × reliabilityModifier ×
 * recencyMultiplier, rounded and capped. Exposed as one function so
 * scripts/verify-ranked-rating-engine.ts can assert this and the SQL
 * agree on the same inputs.
 */
export function ratingDelta(input: {
  performanceGap: number;
  matchWeight: number;
  reliabilityModifier: number;
  recencyMultiplier: number;
  isCalibrated: boolean;
}): number {
  const raw =
    kFactor(input.isCalibrated) *
    input.performanceGap *
    input.matchWeight *
    input.reliabilityModifier *
    input.recencyMultiplier;
  const cap = maxDelta(input.isCalibrated);
  return Math.max(-cap, Math.min(cap, Math.round(raw)));
}

/**
 * The matchmaking search-band preview (§14 of the spec): start at ±100
 * AAR, widen in steps until the max is reached. A UI can walk this list
 * to show "widening search…" without hardcoding the steps twice.
 */
export const MATCHMAKING_BANDS = [100, 150, 200] as const;

/** The party-spread cap (§15) — a ranked doubles party's members must all sit within this many AAR points of each other. AAR-based, never the visible rank name, per the spec's explicit instruction. */
export const RANKED_MAX_PARTY_AAR_SPREAD = 250;

export type PartyAarEligibility = {
  eligible: boolean;
  lowestRating: number | null;
  highestRating: number | null;
  spread: number;
  /** The widest party these players could still form, in raw AAR — for a "you can add someone between X and Y" message. */
  allowedLowestRating: number | null;
  allowedHighestRating: number | null;
};

/**
 * Mirrors `ranked_party_spread()`'s AAR-based rewrite. Uncalibrated
 * players are excluded — same reasoning as before: they have no
 * meaningful rating to compare yet, and excluding them is what makes
 * the ten placement matches playable at all.
 */
export function partyAarEligibility(
  party: ReadonlyArray<{ rating: number; is_calibrated: boolean } | null | undefined>
): PartyAarEligibility {
  const ratings = party.filter((p): p is { rating: number; is_calibrated: boolean } => Boolean(p?.is_calibrated)).map((p) => p.rating);
  if (ratings.length === 0) {
    return {
      eligible: true,
      lowestRating: null,
      highestRating: null,
      spread: 0,
      allowedLowestRating: null,
      allowedHighestRating: null,
    };
  }
  const lowestRating = Math.min(...ratings);
  const highestRating = Math.max(...ratings);
  const spread = highestRating - lowestRating;
  return {
    eligible: spread <= RANKED_MAX_PARTY_AAR_SPREAD,
    lowestRating,
    highestRating,
    spread,
    // The advertised range hangs off whichever end is already fixed, so
    // a message built from this reads "you can add someone as low as Y"
    // rather than stating the abstract 250-point rule.
    allowedLowestRating: highestRating - RANKED_MAX_PARTY_AAR_SPREAD,
    allowedHighestRating: lowestRating + RANKED_MAX_PARTY_AAR_SPREAD,
  };
}

/** `RankedMatchType` (already `"singles" | "doubles"`) doubles as the `mode` a player's rating is tracked under — same categories, no new type needed. */
export type RatingMode = RankedMatchType;
