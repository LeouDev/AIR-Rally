import { RANK_THRESHOLDS, partyAarEligibility, rankForAar, RANKED_MAX_PARTY_AAR_SPREAD } from "@/lib/rating";
import type {
  PlayerRank,
  RankedMatch,
  RankedMatchPlayer,
  RankedPips,
  RankedTier,
} from "@/lib/supabase/types";

/**
 * Presentation rules for AIR/Rally Ranked.
 *
 * Everything here is naming, formatting and preview. The rating engine
 * itself — expected score, performance gap, the rank/star derivation,
 * match weight, recency, reliability — lives in Postgres
 * (20260810000068_dupr_rating_engine.sql) and is mirrored, not
 * reimplemented, by lib/rating.ts: this file imports that mirror for the
 * actual math (`rankForAar`, `partyAarEligibility`, `RANK_THRESHOLDS`)
 * rather than keeping a second ladder definition that could drift from
 * it. What's left here is genuinely presentation-only: badge asset
 * paths, the pip-row visual, formatting, and match-phase tallies that
 * have nothing to do with rating math. Where this file previews
 * something the database also decides (party eligibility), it says so —
 * it's only ever used to disable a button early, never to authorise
 * anything.
 */

export const RANKED_TIER_COUNT = RANK_THRESHOLDS.length;
export const RANKED_PIPS_PER_TIER = 5;
/** Matches c_calibration_matches in apply_ranked_result(). */
export const RANKED_CALIBRATION_MATCHES = 10;

export type RankedTierInfo = (typeof RANK_THRESHOLDS)[number];

export function tierInfo(tier: RankedTier): RankedTierInfo {
  // Clamped rather than indexed blind: `tier` arrives from the database,
  // and a row from a future migration that added an 8th tier should
  // render as the top badge rather than crash the page.
  const index = Math.min(Math.max(tier, 1), RANKED_TIER_COUNT) - 1;
  return RANK_THRESHOLDS[index];
}

/** `/ranks/rank-ace.svg` on cream, `/ranks/rank-ace-navy.svg` on navy. */
export function tierBadgeSrc(tier: RankedTier, on: "light" | "navy" = "light"): string {
  return `/ranks/rank-${tierInfo(tier).slug}${on === "navy" ? "-navy" : ""}.svg`;
}

const NUMERALS = ["I", "II", "III", "IV", "V"] as const;

/**
 * Sub-rank numeral for a star count. Stars are 1-indexed now (never 0 —
 * see the DUPR-rewrite migration's header: a stateless derivation always
 * places you somewhere within a tier's five stars, there's no "zero
 * stars, just demoted" floor state the way the old pip ratchet had one).
 */
export function pipNumeral(pips: RankedPips): string {
  return NUMERALS[Math.min(Math.max(pips, 1), RANKED_PIPS_PER_TIER) - 1];
}

/** "ACE IV". Uppercased at the call site's discretion. */
export function rankLabel(tier: RankedTier, pips: RankedPips): string {
  return `${tierInfo(tier).name} ${pipNumeral(pips)}`;
}

/** "Tier 05" — the zero-padded form the badges are captioned with. */
export function tierNumberLabel(tier: RankedTier): string {
  return `Tier ${String(tier).padStart(2, "0")}`;
}

export type PipState = "filled" | "empty";

/** Five slots, filled left to right up to the star count. The pip row is the ladder's whole visual grammar. */
export function pipRow(pips: RankedPips): PipState[] {
  return Array.from({ length: RANKED_PIPS_PER_TIER }, (_, i) => (i < pips ? "filled" : "empty"));
}

export type ClimbState = {
  /** 0–1, how far through the current tier's five stars. */
  progress: number;
  nextTier: RankedTier | null;
  /**
   * True at the top star of a tier that isn't the ceiling. Informative,
   * not a guarantee: rank is now derived continuously from AAR (see
   * ranked_rank_for_aar() in the DUPR-rewrite migration), so there's no
   * discrete "win this one match and you promote" event the way the old
   * pip ratchet had one — a big win could cross straight into the next
   * tier, and a small one might not move you at all even from star 5.
   * This just means "you're close," never "one win away."
   */
  nearPromotion: boolean;
  atCeiling: boolean;
};

export function climbState(rank: Pick<PlayerRank, "tier" | "pips">): ClimbState {
  const atCeiling = rank.tier >= RANKED_TIER_COUNT;
  return {
    progress: rank.pips / RANKED_PIPS_PER_TIER,
    nextTier: atCeiling ? null : ((rank.tier + 1) as RankedTier),
    nearPromotion: rank.pips >= RANKED_PIPS_PER_TIER && !atCeiling,
    atCeiling,
  };
}

export type CalibrationState = {
  calibrating: boolean;
  played: number;
  remaining: number;
  total: number;
};

export function calibrationState(rank: Pick<PlayerRank, "is_calibrated" | "calibration_matches">): CalibrationState {
  const played = Math.min(rank.calibration_matches, RANKED_CALIBRATION_MATCHES);
  return {
    calibrating: !rank.is_calibrated,
    played,
    remaining: Math.max(0, RANKED_CALIBRATION_MATCHES - played),
    total: RANKED_CALIBRATION_MATCHES,
  };
}

export function winRate(rank: Pick<PlayerRank, "wins" | "losses">): number | null {
  const played = rank.wins + rank.losses;
  return played === 0 ? null : rank.wins / played;
}

export function formatWinRate(rank: Pick<PlayerRank, "wins" | "losses">): string {
  const rate = winRate(rank);
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/** AAR is shown grouped — a four-digit number reads as a rating, not a year. */
export function formatRating(rating: number): string {
  return rating.toLocaleString("en-PH");
}

/** "+32" / "−24". Uses a real minus sign, not a hyphen. */
export function formatRatingDelta(delta: number): string {
  return delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

/** 0-100 confidence label, for a "how sure are we" line next to a rating. Not a skill measure — see ranked_reliability() in the migration. */
export function formatReliability(reliability: number): string {
  return `${Math.round(reliability)}%`;
}

/* -------------------------------------------------------------------------
 * Party eligibility — a preview, not an authorisation
 * ---------------------------------------------------------------------- */

export type PartyEligibilityDisplay = {
  eligible: boolean;
  spread: number;
  /** Tier names derived from the allowed AAR bounds, for a "Volleyer → Kitchen King" style message — display only, the actual check is all-AAR. */
  allowedLowestTierName: string | null;
  allowedHighestTierName: string | null;
  maxSpread: number;
};

/**
 * Wraps `partyAarEligibility()` (the actual AAR-based preview, in
 * lib/rating.ts — that's what mirrors `create_ranked_match()`'s real
 * spread guard) with tier NAMES derived from its allowed AAR bounds,
 * purely so the UI can still say "Volleyer → Kitchen King" instead of
 * "within 250 AAR" — the party-spread rule itself is entirely AAR-based
 * now, per the spec's explicit instruction not to use rank names for the
 * calculation. This function exists only for that one display sentence.
 */
export function partyEligibilityDisplay(
  party: ReadonlyArray<Pick<PlayerRank, "rating" | "is_calibrated"> | null | undefined>
): PartyEligibilityDisplay {
  const result = partyAarEligibility(party);
  return {
    eligible: result.eligible,
    spread: result.spread,
    allowedLowestTierName: result.allowedLowestRating === null ? null : tierInfo(rankForAar(result.allowedLowestRating).tier).name,
    allowedHighestTierName: result.allowedHighestRating === null ? null : tierInfo(rankForAar(result.allowedHighestRating).tier).name,
    maxSpread: RANKED_MAX_PARTY_AAR_SPREAD,
  };
}

/* -------------------------------------------------------------------------
 * Match balance
 * ---------------------------------------------------------------------- */

export type MatchBalance = {
  /** 1 (lopsided) to 5 (very even) — the five-bar meter in the lobby. */
  bars: number;
  label: string;
  /** Absolute AAR gap between the two team averages. */
  gap: number;
};

const BALANCE_LABELS = ["Lopsided", "Uneven", "Fair", "Even", "Very even"] as const;

/**
 * Turns the AAR gap between two sides into the lobby's five-bar meter.
 * Thresholds are in Elo points, where 100 is roughly a 64% expected win —
 * anything past 200 is a match one side should expect to win outright, and
 * that is what "lopsided" is telling the players.
 */
export function matchBalance(teamARatings: number[], teamBRatings: number[]): MatchBalance {
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const gap = Math.abs(mean(teamARatings) - mean(teamBRatings));
  const bars = gap < 25 ? 5 : gap < 60 ? 4 : gap < 110 ? 3 : gap < 200 ? 2 : 1;
  return { bars, label: BALANCE_LABELS[bars - 1], gap: Math.round(gap) };
}

/* -------------------------------------------------------------------------
 * Match state, read the way the screens ask about it
 * ---------------------------------------------------------------------- */

export type OfficiatingTally = { approved: number; total: number; unanimous: boolean };

export function officiatingTally(players: ReadonlyArray<Pick<RankedMatchPlayer, "officiating_vote">>): OfficiatingTally {
  const approved = players.filter((p) => p.officiating_vote === true).length;
  return { approved, total: players.length, unanimous: players.length > 0 && approved === players.length };
}

export type ReadyTally = { ready: number; total: number; allReady: boolean };

export function readyTally(players: ReadonlyArray<Pick<RankedMatchPlayer, "ready">>): ReadyTally {
  const ready = players.filter((p) => p.ready).length;
  return { ready, total: players.length, allReady: players.length > 0 && ready === players.length };
}

export type ConfirmationTally = { accepted: number; total: number; disputed: boolean };

export function confirmationTally(
  players: ReadonlyArray<Pick<RankedMatchPlayer, "result_response">>
): ConfirmationTally {
  return {
    accepted: players.filter((p) => p.result_response === "accepted").length,
    total: players.length,
    disputed: players.some((p) => p.result_response === "disputed"),
  };
}

/**
 * Whether a score is a finished game under the match's own rules. Mirrors
 * submit_ranked_result()'s guard so SUBMIT FINAL can be disabled rather
 * than tapped into an error.
 */
export function isFinishedGame(match: Pick<RankedMatch, "score_a" | "score_b" | "target_score" | "win_by">): boolean {
  const high = Math.max(match.score_a, match.score_b);
  const low = Math.min(match.score_a, match.score_b);
  return high >= match.target_score && high - low >= match.win_by;
}

/** The four reasons a player can give for disputing. Free text is never the first ask. */
export const RANKED_DISPUTE_REASONS = [
  "Incorrect score",
  "Wrong winner",
  "Wrong player",
  "Other",
] as const;

export type RankedDisputeReason = (typeof RANKED_DISPUTE_REASONS)[number];

/** Human phase label for a match, for lists and cards. */
export function matchStatusLabel(match: Pick<RankedMatch, "status">): string {
  switch (match.status) {
    case "lobby":
      return "Waiting on players";
    case "officiating":
      return "Choosing a scorekeeper";
    case "live":
      return "In play";
    case "awaiting_confirmation":
      return "Confirming result";
    case "confirmed":
      return "Final";
    case "disputed":
      return "Disputed";
    case "cancelled":
      return "Cancelled";
  }
}
