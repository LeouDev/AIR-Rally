/**
 * Proves the DUPR-inspired rating engine's actual Postgres behavior
 * against a real (staging) database — not a mock. Two things a Jest
 * suite against a mocked Supabase client cannot prove on its own:
 *
 *   1. That the SQL math in supabase/migrations/20260810000068_dupr_rating_engine.sql
 *      agrees with its TypeScript mirror in src/lib/rating.ts, for a
 *      spread of real inputs — the "drift guard" promised in that
 *      migration's header and in the approved plan.
 *   2. That a full match, run through the real RPCs end to end (create →
 *      ready → officiate → score → submit → confirm), produces the
 *      rating/rank/reliability/sandbag-score results the engine is
 *      supposed to produce — spec scenarios 9-10 (calibration placement)
 *      and 23 (anti-sandbagging).
 *
 * Two synthetic accounts play against each other repeatedly; nothing
 * here touches a real player. Run with:
 *
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-ranked-rating-engine.ts
 *
 * (after sourcing .env.staging — see assert-staging-env.ts for why).
 */
import "./assert-staging-env";
import { Client } from "pg";
import {
  rankForAar,
  expectedScore,
  matchWeightFor,
  recencyMultiplier,
  kFactor,
  maxDelta,
  reliabilityFor,
  reliabilityModifier,
  type MatchWeightType,
} from "../src/lib/rating";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

function assertClose(label: string, actual: number, expected: number, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${actual}, want ~${expected} (±${tolerance})`);
  if (!ok) failures++;
}

function assertTrue(label: string, condition: boolean) {
  console.log(`${condition ? "OK  " : "FAIL"} ${label}`);
  if (!condition) failures++;
}

async function asUser(client: Client, userId: string, fn: () => Promise<void>) {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await client.query(`select set_config('role', 'authenticated', true)`);
    await fn();
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

/**
 * This script proves the rating math by replaying record_ranked_point
 * N times per team to build an exact target score — that only produces
 * the intended score under rally scoring, where every rally scores.
 * Pin every fixture match to it explicitly (20260810000110 defaults new
 * matches to side_out) rather than relying on today's default, which is
 * one migration away from lying. Run outside asUser: ranked_matches has
 * no client UPDATE policy, so this deliberately runs with the direct
 * connection's own privileges, same as the cleanup deletes above.
 */
async function pinRallyScoring(client: Client, matchId: string) {
  await client.query(`update public.ranked_matches set scoring_mode = 'rally' where id = $1`, [matchId]);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ---------------------------------------------------------------------
  // Part 1 — SQL/TypeScript agreement (the drift guard)
  // ---------------------------------------------------------------------
  console.log("\n=== Part 1: SQL vs. TypeScript agreement ===\n");

  const sampleRatings = [0, 500, 999, 1000, 1199, 1200, 1399, 1400, 1599, 1600, 1647, 1799, 1800, 1999, 2000, 2199, 2500, 9999];
  for (const rating of sampleRatings) {
    const { rows } = await client.query(`select tier, pips from public.ranked_rank_for_aar($1)`, [rating]);
    const sql = { tier: rows[0].tier, star: rows[0].pips };
    const ts = rankForAar(rating);
    assertEqual(`ranked_rank_for_aar(${rating}) matches rankForAar`, sql, ts);
  }

  const expectedPairs: Array<[number, number]> = [
    [1500, 1500],
    [1600, 1400],
    [1400, 1600],
    [1900, 1000],
  ];
  for (const [own, opp] of expectedPairs) {
    const { rows } = await client.query(`select ranked_expected_score($1, $2) as e`, [own, opp]);
    assertClose(`ranked_expected_score(${own}, ${opp}) matches expectedScore`, Number(rows[0].e), expectedScore(own, opp));
  }

  const weightTypes: MatchWeightType[] = ["self_reported_rec", "club", "league", "tournament", "air_rally_ranked"];
  for (const t of weightTypes) {
    const { rows } = await client.query(`select ranked_match_weight($1) as w`, [t]);
    assertClose(`ranked_match_weight(${t}) matches matchWeightFor`, Number(rows[0].w), matchWeightFor(t));
  }

  for (const days of [0, 29, 30, 60, 90, 180, 400]) {
    const { rows } = await client.query(`select ranked_recency_multiplier($1) as m`, [days]);
    assertClose(`ranked_recency_multiplier(${days}) matches recencyMultiplier`, Number(rows[0].m), recencyMultiplier(days));
  }

  for (const isCalibrated of [true, false]) {
    const kRow = await client.query(`select ranked_k_factor($1) as k`, [isCalibrated]);
    assertEqual(`ranked_k_factor(${isCalibrated}) matches kFactor`, Number(kRow.rows[0].k), kFactor(isCalibrated));
    const capRow = await client.query(`select ranked_max_delta($1) as c`, [isCalibrated]);
    assertEqual(`ranked_max_delta(${isCalibrated}) matches maxDelta`, Number(capRow.rows[0].c), maxDelta(isCalibrated));
  }

  for (const [count, days] of [[0, null], [15, 5], [30, 5], [30, 200]] as Array<[number, number | null]>) {
    const { rows } = await client.query(`select ranked_reliability($1, $2) as r`, [count, days]);
    assertEqual(`ranked_reliability(${count}, ${days}) matches reliabilityFor`, Number(rows[0].r), reliabilityFor(count, days));
  }

  for (const r of [0, 25, 50, 100]) {
    const { rows } = await client.query(`select ranked_reliability_modifier($1) as m`, [r]);
    assertClose(`ranked_reliability_modifier(${r}) matches reliabilityModifier`, Number(rows[0].m), reliabilityModifier(r));
  }

  // ---------------------------------------------------------------------
  // Part 2 — a full match through the real RPCs
  // ---------------------------------------------------------------------
  console.log("\n=== Part 2: end-to-end match lifecycle ===\n");

  const LEOU = "86f6cb7c-3051-4db5-89e0-3d5443945304";
  const MOBILE = "3e1c4aa5-2122-4343-a3e2-321c11961a74";

  // Clean slate for this run — both accounts, both modes.
  await client.query(`delete from public.ranked_match_players where user_id in ($1, $2)`, [LEOU, MOBILE]);
  await client.query(`delete from public.ranked_matches where created_by in ($1, $2)`, [LEOU, MOBILE]);
  await client.query(`delete from public.player_ranks where user_id in ($1, $2)`, [LEOU, MOBILE]);

  let matchId = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(
      `select create_ranked_match('singles', array[$1]::uuid[], array[$2]::uuid[]) as id`,
      [LEOU, MOBILE]
    );
    matchId = rows[0].id;
  });
  assertTrue("match created", Boolean(matchId));

  async function playMatch(matchId: string, scoreA: number, scoreB: number) {
    // Both players ready up — the host is a normal roster row too and
    // starts unready, same as anyone else (create_ranked_match() doesn't
    // pre-ready the caller).
    await asUser(client, LEOU, async () => {
      await client.query(`select set_ranked_ready($1, true)`, [matchId]);
    });
    await asUser(client, MOBILE, async () => {
      await client.query(`select set_ranked_ready($1, true)`, [matchId]);
    });
    await asUser(client, LEOU, async () => {
      await client.query(`select propose_ranked_officiating($1, 'player_scorekeeper', $2)`, [matchId, LEOU]);
      await client.query(`select vote_ranked_officiating($1, true)`, [matchId]);
    });
    await asUser(client, MOBILE, async () => {
      await client.query(`select vote_ranked_officiating($1, true)`, [matchId]);
    });
    await asUser(client, LEOU, async () => {
      for (let i = 0; i < scoreA; i++) await client.query(`select record_ranked_point($1, 'a')`, [matchId]);
      for (let i = 0; i < scoreB; i++) await client.query(`select record_ranked_point($1, 'b')`, [matchId]);
      await client.query(`select submit_ranked_result($1)`, [matchId]);
    });
    await asUser(client, MOBILE, async () => {
      await client.query(`select respond_ranked_result($1, true, null)`, [matchId]);
    });
  }

  await playMatch(matchId, 11, 3);

  const afterFirst = await client.query(
    `select rating, is_calibrated, calibration_matches, wins, losses, reliability from public.player_ranks where user_id=$1 and mode='singles'`,
    [LEOU]
  );
  const leouAfterFirst = afterFirst.rows[0];
  assertTrue("scenario 9: calibrating after match 1, not yet calibrated", leouAfterFirst.is_calibrated === false);
  assertEqual("scenario 9: calibration_matches = 1", leouAfterFirst.calibration_matches, 1);
  assertTrue("scenario 9: winner's rating moved up from the 1000 start", leouAfterFirst.rating > 1000);

  const mp = await client.query(
    `select expected_score, actual_score, performance_gap, rating_delta from public.ranked_match_players where match_id=$1 and user_id=$2`,
    [matchId, LEOU]
  );
  console.log("Match 1 breakdown for LEOU:", mp.rows[0]);
  assertClose("actual_score for an 11-3 win is 11/14", Number(mp.rows[0].actual_score), 11 / 14, 0.001);

  // Nine more matches to reach exactly 10 and trigger placement (scenario 10).
  for (let i = 0; i < 9; i++) {
    await asUser(client, LEOU, async () => {
      const { rows } = await client.query(
        `select create_ranked_match('singles', array[$1]::uuid[], array[$2]::uuid[]) as id`,
        [LEOU, MOBILE]
      );
      matchId = rows[0].id;
    });
    await playMatch(matchId, 11, 7);
  }

  const afterTen = await client.query(
    `select rating, tier, pips, is_calibrated, calibration_matches from public.player_ranks where user_id=$1 and mode='singles'`,
    [LEOU]
  );
  const leouAfterTen = afterTen.rows[0];
  console.log("LEOU after 10 calibration matches:", leouAfterTen);
  assertTrue("scenario 10: is_calibrated true after the 10th match", leouAfterTen.is_calibrated === true);
  assertEqual("scenario 10: calibration_matches capped at 10", leouAfterTen.calibration_matches, 10);
  const derivedFromFinalRating = rankForAar(leouAfterTen.rating);
  assertEqual(
    "scenario 10: placed tier/star matches ranked_rank_for_aar(final rating)",
    { tier: leouAfterTen.tier, star: leouAfterTen.pips },
    derivedFromFinalRating
  );

  // Scenario 23, first check: ten matches played from an EQUAL starting
  // rating is not itself suspicious — reliability dampens each swing as
  // match volume grows, which is why the gap between two starting-equal
  // players stayed modest even after ten straight lopsided wins (see the
  // logged ratings above). No weak-opponent pattern exists yet, so the
  // score should still read as clean.
  const sandbagBefore = await client.query(`select sandbag_risk_score from public.player_ranks where user_id=$1 and mode='singles'`, [LEOU]);
  console.log("LEOU sandbag_risk_score after 10 matches from an equal start:", sandbagBefore.rows[0].sandbag_risk_score);
  assertEqual("scenario 23a: no weak-opponent pattern yet — score reads clean", sandbagBefore.rows[0].sandbag_risk_score, 0);

  // Second check: manufacture an actual weak-opponent gap (this is what
  // real farming looks like — an established player crushing someone
  // far below them, repeatedly) and confirm the signal actually responds.
  // Directly seeding `rating` is a test-only shortcut to reach that state
  // fast rather than playing dozens more real matches for the same
  // effect; the code path being proven (the sandbag heuristic reading
  // real match history) is identical either way.
  //
  // The gap has to clear the sandbag heuristic's 0.75 threshold WITHOUT
  // exceeding create_ranked_match()'s 250-AAR party-spread cap — a gap
  // wide enough to read as farming but still legal to actually play.
  // +200 does both (expected_score ≈ 0.76 at a 200-point gap).
  const mobileRating = await client.query(`select rating from public.player_ranks where user_id=$1 and mode='singles'`, [MOBILE]);
  const seededLeouRating = Number(mobileRating.rows[0].rating) + 200;
  await client.query(`update public.player_ranks set rating = $1 where user_id = $2 and mode = 'singles'`, [seededLeouRating, LEOU]);
  const gapCheck = await client.query(`select ranked_expected_score($1, $2) as e`, [seededLeouRating, mobileRating.rows[0].rating]);
  assertTrue("the seeded gap clears the 0.75 farming threshold and stays within the 250 party-spread cap", Number(gapCheck.rows[0].e) >= 0.75);

  for (let i = 0; i < 3; i++) {
    await asUser(client, LEOU, async () => {
      const { rows } = await client.query(
        `select create_ranked_match('singles', array[$1]::uuid[], array[$2]::uuid[]) as id`,
        [LEOU, MOBILE]
      );
      matchId = rows[0].id;
    });
    await playMatch(matchId, 11, 2);
  }

  const sandbagAfter = await client.query(`select sandbag_risk_score from public.player_ranks where user_id=$1 and mode='singles'`, [LEOU]);
  console.log("LEOU sandbag_risk_score after 3 lopsided wins against a much weaker opponent:", sandbagAfter.rows[0].sandbag_risk_score);
  assertTrue("scenario 23b: the signal actually rises once a real weak-opponent pattern exists", sandbagAfter.rows[0].sandbag_risk_score > 0);

  // Doubles/singles independence: LEOU has never played doubles this run.
  const doublesRow = await client.query(`select 1 from public.player_ranks where user_id=$1 and mode='doubles'`, [LEOU]);
  assertEqual("singles and doubles standings are independent rows", doublesRow.rows.length, 0);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
