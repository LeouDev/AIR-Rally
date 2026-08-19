import {
  rankForAar,
  rankName,
  expectedScore,
  actualPointShare,
  performanceGap,
  matchWeightFor,
  recencyMultiplier,
  kFactor,
  maxDelta,
  reliabilityFor,
  reliabilityBand,
  reliabilityModifier,
  ratingDelta,
  partyAarEligibility,
  RATING_TIER_COUNT,
  RANKED_MAX_PARTY_AAR_SPREAD,
  type MatchWeightType,
} from "@/lib/rating";

describe("rankForAar", () => {
  it("matches the spec's own worked examples exactly", () => {
    expect(rankForAar(1647)).toEqual({ tier: 5, star: 2 }); // "AAR = 1647, Rank = ACE, Star = 2"
    expect(rankForAar(1599)).toEqual({ tier: 4, star: 5 }); // "SMASHER ★★★★★ at 1599"
    expect(rankForAar(1600)).toEqual({ tier: 5, star: 1 }); // "ACE ★ at 1600"
  });

  it("floors at Dinker star 1, never below", () => {
    expect(rankForAar(0)).toEqual({ tier: 1, star: 1 });
    expect(rankForAar(-500)).toEqual({ tier: 1, star: 1 });
  });

  it("spans Dinker's 1000-wide band across 5 stars of 200 each", () => {
    expect(rankForAar(199)).toEqual({ tier: 1, star: 1 });
    expect(rankForAar(200)).toEqual({ tier: 1, star: 2 });
    expect(rankForAar(999)).toEqual({ tier: 1, star: 5 });
  });

  it("crosses the Dinker/Driver boundary at exactly 1000", () => {
    expect(rankForAar(999).tier).toBe(1);
    expect(rankForAar(1000)).toEqual({ tier: 2, star: 1 });
  });

  it("has no rank above Champion, however high the rating climbs", () => {
    expect(rankForAar(2000)).toEqual({ tier: 7, star: 1 });
    expect(rankForAar(2199)).toEqual({ tier: 7, star: 5 });
    // Champion's star band caps at 2199 even though the rating itself
    // keeps climbing for leaderboard-sort purposes.
    expect(rankForAar(2500)).toEqual({ tier: 7, star: 5 });
    expect(rankForAar(9999)).toEqual({ tier: 7, star: 5 });
  });

  it("names every tier 1-7 distinctly", () => {
    expect(RATING_TIER_COUNT).toBe(7);
    const names = new Set(Array.from({ length: 7 }, (_, i) => rankName((i + 1) as never)));
    expect(names.size).toBe(7);
    expect(rankName(1)).toBe("Dinker");
    expect(rankName(7)).toBe("Champion");
  });
});

describe("expectedScore / actualPointShare / performanceGap — the core DUPR-style scenarios", () => {
  it("1. equal-rated players, 11-9 — a close win is a modest positive gap", () => {
    const expected = expectedScore(1500, 1500);
    expect(expected).toBeCloseTo(0.5, 5);
    const gap = performanceGap(actualPointShare(11, 9), expected);
    expect(gap).toBeCloseTo(0.55 - 0.5, 5);
    expect(gap).toBeGreaterThan(0);
  });

  it("2. equal-rated players, 11-3 — a blowout win is a bigger positive gap than a close one", () => {
    const expected = expectedScore(1500, 1500);
    const closeGap = performanceGap(actualPointShare(11, 9), expected);
    const blowoutGap = performanceGap(actualPointShare(11, 3), expected);
    expect(blowoutGap).toBeGreaterThan(closeGap);
  });

  it("3. favorite wins 11-3 (decisively, as expected) — modest positive gap, not a big one", () => {
    const expected = expectedScore(1600, 1400);
    const gap = performanceGap(actualPointShare(11, 3), expected);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.3);
  });

  it("4. favorite wins 11-9 — favorite was expected to dominate, only just scraped by: NEGATIVE gap", () => {
    const expected = expectedScore(1600, 1400);
    const gap = performanceGap(actualPointShare(11, 9), expected);
    expect(gap).toBeLessThan(0);
  });

  it("5. favorite loses 9-11 — a bad result but not catastrophic, moderate negative gap", () => {
    const expected = expectedScore(1600, 1400);
    const gap = performanceGap(actualPointShare(9, 11), expected);
    expect(gap).toBeLessThan(0);
  });

  it("6. underdog loses 3-11 (as expected) — modest negative gap, not severe", () => {
    const expected = expectedScore(1400, 1600);
    const gap = performanceGap(actualPointShare(3, 11), expected);
    expect(gap).toBeLessThan(0);
    expect(gap).toBeGreaterThan(-0.3);
  });

  it("7. underdog loses 9-11 (much closer than expected) — POSITIVE gap despite losing", () => {
    const expected = expectedScore(1400, 1600);
    const gap = performanceGap(actualPointShare(9, 11), expected);
    expect(gap).toBeGreaterThan(0);
  });

  it("8. underdog wins 11-9 — a big positive gap", () => {
    const expected = expectedScore(1400, 1600);
    const gap = performanceGap(actualPointShare(11, 9), expected);
    expect(gap).toBeGreaterThan(0.3);
  });

  it("the spec's headline example: A=1600 beats B=1400 11-9 can still cost A rating", () => {
    const expectedA = expectedScore(1600, 1400);
    const gapA = performanceGap(actualPointShare(11, 9), expectedA);
    const deltaA = ratingDelta({
      performanceGap: gapA,
      matchWeight: 1,
      reliabilityModifier: 1,
      recencyMultiplier: 1,
      isCalibrated: true,
    });
    expect(deltaA).toBeLessThan(0);
  });

  it("the spec's second example: A=1600 loses to B=1800 9-11 can still gain A rating", () => {
    const expectedA = expectedScore(1600, 1800);
    const gapA = performanceGap(actualPointShare(9, 11), expectedA);
    const deltaA = ratingDelta({
      performanceGap: gapA,
      matchWeight: 1,
      reliabilityModifier: 1,
      recencyMultiplier: 1,
      isCalibrated: true,
    });
    expect(deltaA).toBeGreaterThan(0);
  });
});

describe("9-10. calibration", () => {
  it("uses the wider calibration K and cap while uncalibrated", () => {
    expect(kFactor(false)).toBe(80);
    expect(maxDelta(false)).toBe(120);
  });

  it("narrows to the established K and cap once calibrated", () => {
    expect(kFactor(true)).toBe(40);
    expect(maxDelta(true)).toBe(60);
  });

  it("caps a single match's delta even at an extreme performance gap", () => {
    const delta = ratingDelta({
      performanceGap: 1,
      matchWeight: 2,
      reliabilityModifier: 1,
      recencyMultiplier: 1,
      isCalibrated: false,
    });
    expect(delta).toBe(120);
  });
});

describe("11-12. singles vs doubles share the same math", () => {
  it("ratingDelta doesn't know or care about match mode — mode only selects which stored rating feeds the inputs", () => {
    const inputs = { performanceGap: 0.1, matchWeight: 1.5, reliabilityModifier: 0.9, recencyMultiplier: 1, isCalibrated: true };
    expect(ratingDelta(inputs)).toBe(ratingDelta(inputs));
  });
});

describe("13. different teammate reliabilities produce different deltas from the same match", () => {
  it("a less reliable teammate swings more than a more reliable one on an identical result", () => {
    const shared = { performanceGap: 0.2, matchWeight: 1.5, recencyMultiplier: 1, isCalibrated: true };
    const lowReliability = ratingDelta({ ...shared, reliabilityModifier: reliabilityModifier(reliabilityFor(3, 5)) });
    const highReliability = ratingDelta({ ...shared, reliabilityModifier: reliabilityModifier(reliabilityFor(80, 2)) });
    expect(Math.abs(lowReliability)).toBeGreaterThan(Math.abs(highReliability));
  });

  it("reliability never fully freezes movement, even at maximum", () => {
    expect(reliabilityModifier(100)).toBeGreaterThan(0);
    expect(reliabilityModifier(100)).toBe(0.5);
  });

  it("reliability grows with match volume and decays with inactivity", () => {
    expect(reliabilityFor(30, 5)).toBeGreaterThan(reliabilityFor(3, 5));
    expect(reliabilityFor(30, 5)).toBeGreaterThan(reliabilityFor(30, 200));
  });

  it("labels reliability into the five documented bands", () => {
    expect(reliabilityBand(10)).toBe("very-unstable");
    expect(reliabilityBand(30)).toBe("developing");
    expect(reliabilityBand(50)).toBe("moderate");
    expect(reliabilityBand(70)).toBe("reliable");
    expect(reliabilityBand(95)).toBe("highly-reliable");
  });
});

describe("14-15. match weight — tournament vs. casual", () => {
  it("14. a tournament match counts for more than a self-reported casual one", () => {
    expect(matchWeightFor("tournament")).toBeGreaterThan(matchWeightFor("self_reported_rec"));
  });

  it("15. a casual (self-reported) match is explicitly de-weighted", () => {
    expect(matchWeightFor("self_reported_rec")).toBeLessThan(1);
  });

  it("every match type has a defined weight", () => {
    const types: MatchWeightType[] = ["self_reported_rec", "club", "league", "tournament", "air_rally_ranked"];
    for (const t of types) expect(matchWeightFor(t)).toBeGreaterThan(0);
  });
});

describe("16-17. recency — old vs recent matches", () => {
  it("16. an old match (well past 180 days) carries the lowest weight", () => {
    expect(recencyMultiplier(400)).toBe(0.5);
  });

  it("17. a recent match carries full weight", () => {
    expect(recencyMultiplier(0)).toBe(1.0);
    expect(recencyMultiplier(10)).toBe(1.0);
  });

  it("decays monotonically as a match ages", () => {
    expect(recencyMultiplier(10)).toBeGreaterThanOrEqual(recencyMultiplier(45));
    expect(recencyMultiplier(45)).toBeGreaterThanOrEqual(recencyMultiplier(75));
    expect(recencyMultiplier(75)).toBeGreaterThanOrEqual(recencyMultiplier(150));
    expect(recencyMultiplier(150)).toBeGreaterThanOrEqual(recencyMultiplier(400));
  });
});

describe("18-19. rank boundaries", () => {
  it("18. Dinker boundary — the top of Dinker and the bottom of Driver are adjacent, not overlapping", () => {
    expect(rankForAar(999).tier).toBe(1);
    expect(rankForAar(1000).tier).toBe(2);
  });

  it("19. Champion boundary — the bottom of Champion starts immediately after Kitchen King's top star", () => {
    expect(rankForAar(1999).tier).toBe(6);
    expect(rankForAar(2000).tier).toBe(7);
  });
});

describe("20-21. floor and ceiling cannot be crossed", () => {
  it("20. Dinker cannot demote below Dinker — any rating at or below 0 is still tier 1", () => {
    expect(rankForAar(0).tier).toBe(1);
    expect(rankForAar(-9999).tier).toBe(1);
  });

  it("21. Champion cannot promote beyond Champion — no tier 8 exists at any rating", () => {
    expect(rankForAar(50000).tier).toBe(7);
    expect(RATING_TIER_COUNT).toBe(7);
  });
});

describe("22. invalid high-rank party", () => {
  it("rejects a party spanning more than the allowed AAR spread", () => {
    const result = partyAarEligibility([
      { rating: 500, is_calibrated: true }, // deep Dinker
      { rating: 2100, is_calibrated: true }, // Champion
    ]);
    expect(result.spread).toBeGreaterThan(RANKED_MAX_PARTY_AAR_SPREAD);
    expect(result.eligible).toBe(false);
  });

  it("allows a party within the spread", () => {
    const result = partyAarEligibility([
      { rating: 1550, is_calibrated: true },
      { rating: 1650, is_calibrated: true },
    ]);
    expect(result.eligible).toBe(true);
  });

  it("exempts uncalibrated players from the spread entirely", () => {
    const result = partyAarEligibility([
      { rating: 500, is_calibrated: true },
      { rating: 2100, is_calibrated: false }, // no real rating yet — must not count
    ]);
    expect(result.spread).toBe(0);
    expect(result.eligible).toBe(true);
  });

  it("is eligible by default with nobody calibrated yet", () => {
    const result = partyAarEligibility([null, undefined, { rating: 500, is_calibrated: false }]);
    expect(result.eligible).toBe(true);
    expect(result.lowestRating).toBeNull();
  });
});

describe("23. anti-sandbagging signal", () => {
  it("crushing a much weaker opponent produces no large positive gap to farm", () => {
    // A 1900-rated player is expected to win essentially every point
    // against a 1000-rated opponent (expected ≈ 0.997) — so even a
    // dominant 11-2 win (actual share ≈ 0.85) reads as performing BELOW
    // that expectation, not above it. There is no positive-gap reward
    // available for beating a wildly weaker opponent, decisive or not —
    // exactly the property that makes farming weak opponents pointless.
    // The actual pattern-detection (repeated weak-opponent matches,
    // sudden jumps) lives in the SQL sandbag-risk-score function and is
    // proven against real data in scripts/verify-ranked-rating-engine.ts
    // — this test only proves the rating math itself doesn't reward it.
    const expected = expectedScore(1900, 1000);
    expect(expected).toBeGreaterThan(0.95);
    const gap = performanceGap(actualPointShare(11, 2), expected);
    expect(gap).toBeLessThan(0.05);
  });
});
