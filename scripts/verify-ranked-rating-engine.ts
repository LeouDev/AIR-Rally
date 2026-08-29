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
 * ⚠️ THIS SUITE WRITES TO STAGING AND ITS ACCOUNTS ARE THE FOUNDER'S OWN
 * EMAIL ADDRESSES. A full run confirms ~30 matches and inserts ~190
 * notification rows. It clears its accounts' device push tokens during
 * setup so none of that reaches a real phone — on 2026-08-30, before that
 * existed, a run pushed ~90 notifications to the founder's device and one
 * was reported as a production bug. Read the note above the token-clearing
 * query before changing how it works.
 *
 * Two synthetic accounts play against each other repeatedly (four for the
 * doubles case); nothing here touches a real player's DATA, though the
 * accounts themselves are real. Run with:
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

  // Doubles partners. Declared up here rather than at the doubles case so
  // setup and teardown below can cover every account this suite touches —
  // see the note on push tokens. The reasoning for these three specific
  // accounts is at the doubles case itself.
  const SPARES = [
    "fbc1b5e4-8fcc-4d61-b937-e45a4b5e53dd",
    "366d3dcb-bb90-4342-b436-582eec652228",
    "a3a2d9b8-f169-4165-8a00-3caee5d9dc7b",
  ];
  const SUITE_ACCOUNTS = [LEOU, MOBILE, ...SPARES];

  // ⚠️ PUSH TOKENS — DO NOT REMOVE. THIS IS NOT HYGIENE, IT IS THE FIX.
  //
  // A full run confirms ~30 matches and inserts ~190 notification rows in
  // about seven minutes. Every one fires notify_push_on_notification_insert,
  // which POSTs to the push webhook *if the recipient has a device token*.
  //
  // These are not anonymous fixtures: LEOU and MOBILE resolve to
  // galileouuu@gmail.com and galileouuu+mobiletest@gmail.com — the
  // founder's real addresses. On 2026-08-30 a run of this suite pushed
  // roughly ninety notifications to the founder's actual phone, who
  // reasonably read one ("counts at half") as a production bug and
  // reported it. It cost two people an investigation.
  //
  // Clearing the tokens BEFORE the run is the only thing that prevents
  // it. Deleting the notification rows in teardown does not: by then the
  // pushes have already been delivered. The trigger deliberately stays
  // live — notification-on-confirm is real behaviour worth exercising —
  // and it no-ops for a recipient with no token, which is exactly the
  // state this creates.
  //
  // It re-clears every run on purpose. `galileouuu+mobiletest@gmail.com`
  // is an address the founder actually signs in with, so a token WILL
  // come back; this must be self-correcting rather than a one-time tidy.
  //
  // VERIFIED 2026-08-30, not assumed: with tokens cleared, a full run
  // produced ZERO push-webhook calls. It did fire the EMAIL webhook 95
  // times — once per notification — and every one returned
  // `{"received":true,"emailed":false}`, because none of the ranked
  // notification types is currently email-eligible.
  //
  // That last part is luck, not design, and it is the residual hazard
  // here: the day someone makes `ranked_result_confirmed` (or any ranked
  // type) send email, this suite starts delivering ~95 real emails to the
  // founder's address per run, and clearing push tokens will not stop it.
  // If you add a ranked notification type to the email path, come back
  // and suppress it for these accounts too.
  const clearedTokens = await client.query(
    `delete from public.device_push_tokens where user_id = any($1) returning user_id`,
    [SUITE_ACCOUNTS]
  );
  if (clearedTokens.rowCount) {
    console.log(`[setup] cleared ${clearedTokens.rowCount} device push token(s) for this suite's accounts — see the note in this file before "fixing" this.`);
  }

  // Clean slate for this run — every account this suite touches.
  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_match_players where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.player_ranks where user_id = any($1)`, [SUITE_ACCOUNTS]);

  let matchId = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(
      `select create_ranked_match('singles', array[$1]::uuid[], array[$2]::uuid[]) as id`,
      [LEOU, MOBILE]
    );
    matchId = rows[0].id;
  });
  assertTrue("match created", Boolean(matchId));

  /**
   * Drives a match through the real RPCs end to end. `roster` defaults to
   * the singles pair; the doubles case passes all four. LEOU is always the
   * host and scorekeeper, so every other participant readies, votes and
   * responds — which is also what makes this exercise the unanimity path
   * rather than a shortcut: apply_ranked_result only fires once EVERY
   * player has accepted (20260810000067's apply_ranked_result_if_unanimous).
   */
  async function playMatch(matchId: string, scoreA: number, scoreB: number, roster: string[] = [LEOU, MOBILE]) {
    const others = roster.filter((id) => id !== LEOU);

    // Everyone readies up — the host is a normal roster row too and starts
    // unready, same as anyone else (create_ranked_match() doesn't pre-ready
    // the caller).
    await asUser(client, LEOU, async () => {
      await client.query(`select set_ranked_ready($1, true)`, [matchId]);
    });
    for (const id of others) {
      await asUser(client, id, async () => {
        await client.query(`select set_ranked_ready($1, true)`, [matchId]);
      });
    }

    await asUser(client, LEOU, async () => {
      await client.query(`select propose_ranked_officiating($1, 'player_scorekeeper', $2)`, [matchId, LEOU]);
      await client.query(`select vote_ranked_officiating($1, true)`, [matchId]);
    });
    for (const id of others) {
      await asUser(client, id, async () => {
        await client.query(`select vote_ranked_officiating($1, true)`, [matchId]);
      });
    }

    await pinRallyScoring(client, matchId);

    await asUser(client, LEOU, async () => {
      for (let i = 0; i < scoreA; i++) await client.query(`select record_ranked_point($1, 'a')`, [matchId]);
      for (let i = 0; i < scoreB; i++) await client.query(`select record_ranked_point($1, 'b')`, [matchId]);
      await client.query(`select submit_ranked_result($1)`, [matchId]);
    });

    // submit_ranked_result records the scorekeeper's own acceptance, so
    // only the others still owe a response.
    for (const id of others) {
      await asUser(client, id, async () => {
        await client.query(`select respond_ranked_result($1, true, null)`, [matchId]);
      });
    }
  }

  await playMatch(matchId, 11, 3);

  const afterFirst = await client.query(
    `select rating, is_calibrated, calibration_matches, wins, losses, reliability from public.player_ranks where user_id=$1`,
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
    `select rating, tier, pips, is_calibrated, calibration_matches from public.player_ranks where user_id=$1`,
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
  const sandbagBefore = await client.query(`select sandbag_risk_score from public.player_ranks where user_id=$1`, [LEOU]);
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
  const mobileRating = await client.query(`select rating from public.player_ranks where user_id=$1`, [MOBILE]);
  const seededLeouRating = Number(mobileRating.rows[0].rating) + 200;
  await client.query(`update public.player_ranks set rating = $1 where user_id = $2`, [seededLeouRating, LEOU]);
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

  const sandbagAfter = await client.query(`select sandbag_risk_score from public.player_ranks where user_id=$1`, [LEOU]);
  console.log("LEOU sandbag_risk_score after 3 lopsided wins against a much weaker opponent:", sandbagAfter.rows[0].sandbag_risk_score);
  // ⚠️ THIS ASSERTION FAILS TODAY, AND THE FAILURE IS THE FINDING —
  // BUT NOT NECESSARILY IN THE DIRECTION THIS TEST ASSUMES.
  //
  // It is not a stale test: it asserts the heuristic as written in
  // 20260810000068 and carried unchanged through 085 and 087 —
  //
  //     where recent.won and recent.expected_score >= 0.75
  //     + case when is_calibrated and abs(v_delta) >= max_delta*0.75 then 30 end
  //
  // 20260810000100 replaced that with:
  //
  //     where recent.expected_score < 0.4 and recent.won
  //
  // WHICH DEFINITION IS CORRECT IS AN OPEN PRODUCT QUESTION. Do not
  // assume the older one. They fire on opposite populations:
  //
  //   >= 0.75  fires on a player who wins matches they were heavily
  //            FAVOURED to win — i.e. farming weak opponents. It also
  //            fires on any correctly-rated strong player, who does
  //            exactly that every week.
  //   < 0.4    fires on a player who wins as an UNDERDOG. That is the
  //            textbook sandbagger — someone whose rating sits BELOW
  //            their true skill — and is arguably the better definition.
  //
  // Two things 100 also dropped, relevant to judging it:
  //   * The +30 large-swing term. The score's `least(100, ...)` cap is
  //     now unreachable: the count term alone maxes at 70.
  //   * The `performance_gap is not null` filter. Effect on counting is
  //     nil (`null < 0.4` is null, so those rows were never counted
  //     either way), but without it, non-rating matches occupy slots in
  //     the `limit 10` window and dilute the sample.
  //
  // SEPARATELY FROM WHICH IS RIGHT: none of this was stated in 100,
  // whose subject was freezing ratings for unbooked matches. That is a
  // process question independent of the product one.
  //
  // Nothing currently READS sandbag_risk_score — no admin surface, no
  // API, no UI, in either repo. So whichever way this resolves, no
  // behaviour depends on it today; the cost is that the number being
  // accumulated may not mean what a future reviewer assumes.
  //
  // DO NOT resolve this by relaxing the assertion or matching it to
  // current behaviour. Until the definition is decided, this red is the
  // honest state: the engine no longer does what this was written to
  // prove, and that discrepancy is the thing worth seeing.
  //
  // Why it went unseen: 085 broke this suite, 100 shipped afterwards, so
  // the guard that would have caught 100 was already dead when 100
  // landed. See [[create-or-replace-regression-trap]].
  assertTrue("scenario 23b: the signal actually rises once a real weak-opponent pattern exists", sandbagAfter.rows[0].sandbag_risk_score > 0);

  // ---------------------------------------------------------------------
  // Mode is a property of the MATCH, not of the RATING
  // ---------------------------------------------------------------------
  //
  // This replaces an assertion that died with 20260810000085. The old one
  // read: "LEOU has never played doubles this run, so no doubles
  // player_ranks row exists" — a real check on per-mode independence under
  // 20260810000068's schema, and meaningless once 085 removed the mode
  // dimension from player_ranks entirely.
  //
  // 085 did NOT simply delete the concept. It removed mode from
  // player_ranks while deliberately KEEPING ranked_match_players.mode as a
  // fact about the match. So the successor has to assert both halves, or
  // it tests half a change and looks complete.
  //
  // Everything below discriminates: under 068's schema a doubles match
  // would create a SECOND player_ranks row and leave the singles rating
  // untouched, so the row-count and rating-moved assertions both fail.
  // Under 085's they pass. That is the whole point of restoring it.
  console.log("\n--- One rating, both formats ---\n");

  // Three spare accounts, deliberately NOT MOBILE. By this point LEOU is
  // calibrated with a seeded high rating and MOBILE has lost thirteen
  // straight, so a party containing both could exceed the party-spread cap
  // and be REFUSED — which would fail this test for a reason that has
  // nothing to do with the invariant under test. ranked_party_spread()
  // only considers CALIBRATED players, so a party whose only calibrated
  // member is LEOU has a spread of zero by construction.
  //
  // Do not "simplify" this by reusing MOBILE, and do not raise or bypass
  // the cap to make it fit: the cap staying a real constraint that this
  // match passes on its own merits is what keeps the doubles case honest.
  // SPARES and their clean slate are set up at the top of this function.

  // Captured BEFORE, asserted unchanged AFTER — so the ordering lives in
  // the assertion rather than in the order of the lines. Checked before
  // the doubles match alone, "exactly one row" is trivially true and would
  // pass under the per-mode schema too.
  const rowsBefore = await client.query(`select count(*)::int as n from public.player_ranks where user_id=$1`, [LEOU]);
  const ratingBefore = await client.query(
    `select rating, wins, losses from public.player_ranks where user_id=$1`,
    [LEOU]
  );
  assertEqual("LEOU holds exactly one rating row before playing doubles", rowsBefore.rows[0].n, 1);

  let doublesId = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(
      `select create_ranked_match('doubles', array[$1,$2]::uuid[], array[$3,$4]::uuid[]) as id`,
      [LEOU, SPARES[0], SPARES[1], SPARES[2]]
    );
    doublesId = rows[0].id;
  });

  // Explicit, before any invariant assertion: if the party-spread cap (or
  // anything else) refused this match, the suite must FAIL here naming it
  // — never skip the doubles coverage and report green.
  assertTrue("a doubles match was actually created (a spread-cap refusal must fail here, not skip)", Boolean(doublesId));

  const doublesRoster = await client.query(
    `select count(*)::int as n from public.ranked_match_players where match_id=$1`,
    [doublesId]
  );
  assertEqual("the doubles match has four player rows", doublesRoster.rows[0].n, 4);

  await playMatch(doublesId, 11, 6, [LEOU, ...SPARES]);

  const rowsAfter = await client.query(`select count(*)::int as n from public.player_ranks where user_id=$1`, [LEOU]);
  const ratingAfter = await client.query(
    `select rating, wins, losses from public.player_ranks where user_id=$1`,
    [LEOU]
  );

  // 1. The direct successor to the deleted line: still ONE row, not two.
  assertEqual("a doubles result did not create a second rating row — one rating per player", rowsAfter.rows[0].n, 1);

  // 2. That same row moved. Under 068 the doubles result would have landed
  //    on a separate row and this rating would be unchanged.
  assertTrue(
    "the doubles result moved the SAME rating the singles matches built",
    ratingAfter.rows[0].rating !== ratingBefore.rows[0].rating
  );

  // 3. Win/loss accumulates across formats on the one row — what "one
  //    progression" actually means, beyond the rating number itself.
  assertEqual(
    "the doubles win accumulated onto the same row's record",
    ratingAfter.rows[0].wins,
    ratingBefore.rows[0].wins + 1
  );

  // 4. The half 085 KEPT: mode is still recorded per match.
  const matchMode = await client.query(
    `select distinct mode from public.ranked_match_players where match_id=$1`,
    [doublesId]
  );
  assertEqual("ranked_match_players still records the format per match", matchMode.rows.map((r) => r.mode), ["doubles"]);

  // Data hygiene, explicitly NOT the anti-spam measure — the pushes, if
  // any token slipped through, went out long before this line. Setup
  // re-clears anyway, so this only keeps staging tidy between runs.
  const sweptNotifs = await client.query(
    `delete from public.notifications where user_id = any($1) returning id`,
    [SUITE_ACCOUNTS]
  );
  console.log(`\n[teardown] removed ${sweptNotifs.rowCount} notification row(s) this run created.`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
