import {
  tierInfo,
  tierBadgeSrc,
  pipNumeral,
  rankLabel,
  tierNumberLabel,
  pipRow,
  climbState,
  calibrationState,
  winRate,
  formatWinRate,
  formatRating,
  formatRatingDelta,
  formatReliability,
  partyEligibilityDisplay,
  matchBalance,
  officiatingTally,
  readyTally,
  confirmationTally,
  isFinishedGame,
  matchStatusLabel,
  RANKED_TIER_COUNT,
} from "@/lib/ranked";
import { RANKED_MAX_PARTY_AAR_SPREAD } from "@/lib/rating";

describe("tierInfo / tierBadgeSrc", () => {
  it("maps every tier 1-7 to a distinct name", () => {
    const names = new Set(Array.from({ length: RANKED_TIER_COUNT }, (_, i) => tierInfo((i + 1) as never).name));
    expect(names.size).toBe(RANKED_TIER_COUNT);
  });

  it("clamps an out-of-range tier instead of throwing", () => {
    // @ts-expect-error deliberately out of the declared 1-7 range, as an
    // unmigrated client sending the old Rally Legend tier (8) would.
    expect(() => tierInfo(8)).not.toThrow();
    // @ts-expect-error same, below range
    expect(tierInfo(0).tier).toBe(1);
  });

  it("picks the navy variant only when asked", () => {
    expect(tierBadgeSrc(5)).toBe("/ranks/rank-ace.svg");
    expect(tierBadgeSrc(5, "navy")).toBe("/ranks/rank-ace-navy.svg");
  });
});

describe("pipNumeral / rankLabel", () => {
  it("counts I through V", () => {
    expect([1, 2, 3, 4, 5].map((n) => pipNumeral(n as never))).toEqual(["I", "II", "III", "IV", "V"]);
  });

  it("clamps an out-of-range star instead of throwing", () => {
    // @ts-expect-error stars are never 0 under stateless derivation, but a
    // stale client payload could still send one.
    expect(pipNumeral(0)).toBe("I");
    // @ts-expect-error same, above range
    expect(pipNumeral(6)).toBe("V");
  });

  it("always includes the numeral in the label", () => {
    expect(rankLabel(5, 1)).toBe("Ace I");
    expect(rankLabel(5, 4)).toBe("Ace IV");
  });

  it("zero-pads the tier number label", () => {
    expect(tierNumberLabel(5)).toBe("Tier 05");
  });
});

describe("pipRow", () => {
  it("fills left to right and leaves the rest empty", () => {
    expect(pipRow(3)).toEqual(["filled", "filled", "filled", "empty", "empty"]);
  });
});

describe("climbState", () => {
  it("points at the next tier with room to climb", () => {
    const state = climbState({ tier: 5, pips: 2 });
    expect(state).toMatchObject({ progress: 0.4, nextTier: 6, nearPromotion: false, atCeiling: false });
  });

  it("flags nearPromotion only below the ceiling", () => {
    expect(climbState({ tier: 5, pips: 5 }).nearPromotion).toBe(true);
    // Champion (7) has nowhere higher to climb into, so the flag must
    // never fire there even at its top star.
    expect(climbState({ tier: 7, pips: 5 }).nearPromotion).toBe(false);
  });

  it("has no next tier at the ceiling", () => {
    const state = climbState({ tier: 7, pips: 3 });
    expect(state.nextTier).toBeNull();
    expect(state.atCeiling).toBe(true);
  });
});

describe("calibrationState", () => {
  it("reports remaining matches while calibrating", () => {
    expect(calibrationState({ is_calibrated: false, calibration_matches: 7 })).toEqual({
      calibrating: true,
      played: 7,
      remaining: 3,
      total: 10,
    });
  });

  it("is not calibrating once placed, regardless of the stored count", () => {
    expect(calibrationState({ is_calibrated: true, calibration_matches: 10 }).calibrating).toBe(false);
  });
});

describe("winRate / formatWinRate", () => {
  it("is null with no matches played, not NaN or zero", () => {
    expect(winRate({ wins: 0, losses: 0 })).toBeNull();
    expect(formatWinRate({ wins: 0, losses: 0 })).toBe("—");
  });

  it("computes wins over total", () => {
    expect(winRate({ wins: 27, losses: 15 })).toBeCloseTo(0.6429, 3);
    expect(formatWinRate({ wins: 27, losses: 15 })).toBe("64.3%");
  });
});

describe("formatRating / formatRatingDelta", () => {
  it("groups the rating", () => {
    expect(formatRating(1742)).toBe("1,742");
  });

  it("signs the delta with a real minus, not a hyphen", () => {
    expect(formatRatingDelta(32)).toBe("+32");
    expect(formatRatingDelta(-24)).toBe("−24");
    expect(formatRatingDelta(0)).toBe("+0");
  });
});

describe("formatReliability", () => {
  it("rounds to a whole-number percent", () => {
    expect(formatReliability(63.4)).toBe("63%");
    expect(formatReliability(0)).toBe("0%");
    expect(formatReliability(100)).toBe("100%");
  });
});

describe("partyEligibilityDisplay", () => {
  it("is eligible with nobody calibrated yet — placement matches must stay playable", () => {
    const result = partyEligibilityDisplay([{ rating: 1000, is_calibrated: false }, null, undefined]);
    expect(result.eligible).toBe(true);
    expect(result.allowedLowestTierName).toBeNull();
    expect(result.allowedHighestTierName).toBeNull();
  });

  it(`is eligible up to a ${RANKED_MAX_PARTY_AAR_SPREAD}-AAR spread`, () => {
    const result = partyEligibilityDisplay([
      { rating: 1450, is_calibrated: true },
      { rating: 1650, is_calibrated: true },
    ]);
    expect(result.spread).toBe(200);
    expect(result.eligible).toBe(true);
  });

  it("rejects a spread wider than the max and names the allowed range by tier", () => {
    const result = partyEligibilityDisplay([
      { rating: 1000, is_calibrated: true }, // Driver
      { rating: 1700, is_calibrated: true }, // Ace
    ]);
    expect(result.spread).toBe(700);
    expect(result.eligible).toBe(false);
    // 1700 - 350 = 1350 (Volleyer); 1000 + 350 = 1350 (Volleyer) — the
    // widest party these two ratings could still legally form. Both
    // bounds land in the same tier at this cap and these fixture
    // ratings — that's correct, not a bug in the display logic.
    expect(result.allowedLowestTierName).toBe("Volleyer");
    expect(result.allowedHighestTierName).toBe("Volleyer");
    expect(result.maxSpread).toBe(RANKED_MAX_PARTY_AAR_SPREAD);
  });

  it("ignores uncalibrated players when computing the spread", () => {
    const result = partyEligibilityDisplay([
      { rating: 1000, is_calibrated: true },
      { rating: 9999, is_calibrated: false }, // unplaced — must not count
      { rating: 1200, is_calibrated: true },
    ]);
    expect(result.spread).toBe(200);
    expect(result.eligible).toBe(true);
  });
});

describe("matchBalance", () => {
  it("reads as very even for near-identical team ratings", () => {
    expect(matchBalance([1500, 1510], [1495, 1505]).bars).toBe(5);
  });

  it("reads as lopsided for a wide gap", () => {
    const result = matchBalance([1900, 1850], [1200, 1150]);
    expect(result.bars).toBe(1);
    expect(result.label).toBe("Lopsided");
  });
});

describe("officiatingTally / readyTally / confirmationTally", () => {
  it("is unanimous only when every vote is a yes", () => {
    expect(officiatingTally([{ officiating_vote: true }, { officiating_vote: true }]).unanimous).toBe(true);
    expect(officiatingTally([{ officiating_vote: true }, { officiating_vote: null }]).unanimous).toBe(false);
    expect(officiatingTally([{ officiating_vote: true }, { officiating_vote: false }]).unanimous).toBe(false);
  });

  it("is not unanimous/ready/accepted on an empty list", () => {
    expect(officiatingTally([]).unanimous).toBe(false);
    expect(readyTally([]).allReady).toBe(false);
  });

  it("counts ready players", () => {
    expect(readyTally([{ ready: true }, { ready: false }, { ready: true }])).toEqual({
      ready: 2,
      total: 3,
      allReady: false,
    });
  });

  it("flags a dispute even if it isn't unanimous", () => {
    const tally = confirmationTally([
      { result_response: "accepted" },
      { result_response: "disputed" },
      { result_response: "pending" },
    ]);
    expect(tally).toEqual({ accepted: 1, total: 3, disputed: true });
  });
});

describe("isFinishedGame", () => {
  const base = { target_score: 11, win_by: 2 };

  it("is not finished below the target", () => {
    expect(isFinishedGame({ ...base, score_a: 9, score_b: 8 })).toBe(false);
  });

  it("is not finished at the target without the win-by margin", () => {
    expect(isFinishedGame({ ...base, score_a: 11, score_b: 10 })).toBe(false);
  });

  it("is finished at the target with the margin met", () => {
    expect(isFinishedGame({ ...base, score_a: 11, score_b: 8 })).toBe(true);
  });

  it("is finished past the target once the margin is met (deuce)", () => {
    expect(isFinishedGame({ ...base, score_a: 13, score_b: 11 })).toBe(true);
    expect(isFinishedGame({ ...base, score_a: 12, score_b: 11 })).toBe(false);
  });
});

describe("matchStatusLabel", () => {
  it("has a human label for every status", () => {
    const statuses = ["lobby", "officiating", "live", "awaiting_confirmation", "confirmed", "disputed", "cancelled"] as const;
    for (const status of statuses) {
      expect(matchStatusLabel({ status })).toEqual(expect.any(String));
    }
  });
});
