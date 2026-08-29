/**
 * Proves apply_ranked_result()'s discount behavior (20260810000112)
 * directly against staging — not by reasoning about the SQL, by running
 * it. Bypasses the whole lobby/officiating/live-scoring ceremony on
 * purpose: apply_ranked_result() only cares about a match's final state
 * (score_a/score_b/winning_team/status='awaiting_confirmation'), so this
 * constructs that state directly for full control over the one variable
 * that matters — whether the match is booked — and compares an
 * UNBOOKED calibrated player's actual delta against what the identical
 * inputs would have produced at full weight, computed independently in
 * SQL from the same helper functions apply_ranked_result() itself calls.
 *
 * Also exercises the two adjacent claims from this migration's header
 * in the same run: an uncalibrated player is never discounted (booked
 * or not), and booked_rated_matches only increments for a booked match
 * (it never does here, since every match this script creates is
 * unbooked by construction — event_id stays null).
 *
 * scripts/verify-ranked-rating-engine.ts's Part 2 currently can't run
 * end-to-end (a pre-existing, unrelated break: it queries a `mode`
 * column on player_ranks that 20260810000085 removed) — that's flagged
 * separately, not fixed here. This script exists so today's change gets
 * a real check without depending on that repair.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-unbooked-discount.ts
 * (after sourcing .env.staging).
 */
import "./assert-staging-env";
import { Client } from "pg";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

// Same synthetic accounts scripts/verify-ranked-rating-engine.ts uses.
const LEOU = "86f6cb7c-3051-4db5-89e0-3d5443945304";
const MOBILE = "3e1c4aa5-2122-4343-a3e2-321c11961a74";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`delete from public.ranked_match_players where user_id in ($1, $2)`, [LEOU, MOBILE]);
  await client.query(`delete from public.ranked_matches where created_by in ($1, $2)`, [LEOU, MOBILE]);
  await client.query(`delete from public.player_ranks where user_id in ($1, $2)`, [LEOU, MOBILE]);

  const season = await client.query(`select public.current_ranked_season() as id`);
  const seasonId = season.rows[0].id;

  // LEOU: already calibrated, known rating/reliability — set directly
  // rather than played into, since apply_ranked_result() only reads
  // CURRENT is_calibrated, not how a player got there.
  await client.query(
    `insert into public.player_ranks
       (season_id, user_id, rating, tier, pips, reliability, is_calibrated, calibration_matches, wins, losses, current_streak)
     values ($1, $2, 1500, 4, 3, 60, true, 10, 5, 4, 1)`,
    [seasonId, LEOU]
  );
  // MOBILE: uncalibrated, at the (new) starting rating — the opponent,
  // and itself a check that an uncalibrated player is never discounted.
  await client.query(
    `insert into public.player_ranks (season_id, user_id, rating, is_calibrated, calibration_matches)
     values ($1, $2, 1100, false, 3)`,
    [seasonId, MOBILE]
  );

  async function playUnbookedMatch(scoreA: number, scoreB: number) {
    const match = await client.query(
      `insert into public.ranked_matches
         (season_id, match_type, status, rated, match_weight_type, score_a, score_b, winning_team, created_by)
       values ($1, 'singles', 'awaiting_confirmation', true, 'air_rally_ranked', $2, $3, $4, $5)
       returning id`,
      [seasonId, scoreA, scoreB, scoreA > scoreB ? "a" : "b", LEOU]
    );
    const matchId = match.rows[0].id;
    await client.query(
      `insert into public.ranked_match_players (match_id, user_id, team, is_host, ready)
       values ($1, $2, 'a', true, true), ($1, $3, 'b', false, true)`,
      [matchId, LEOU, MOBILE]
    );
    return matchId;
  }

  // ---- The real case: LEOU (calibrated) wins an unbooked match ----
  const leouBefore = await client.query(
    `select rating, reliability, calibration_matches, wins, losses, last_match_at from public.player_ranks where season_id=$1 and user_id=$2`,
    [seasonId, LEOU]
  );
  const mobileBefore = await client.query(`select rating from public.player_ranks where season_id=$1 and user_id=$2`, [seasonId, MOBILE]);

  const matchId = await playUnbookedMatch(11, 5);
  await client.query(`select public.apply_ranked_result($1)`, [matchId]);

  const leouAfter = await client.query(`select rating, reliability, wins, losses, current_streak, calibration_matches, booked_rated_matches from public.player_ranks where season_id=$1 and user_id=$2`, [seasonId, LEOU]);
  const leouRow = await client.query(
    `select rating_before, rating_after, rating_delta, tier_before, tier_after from public.ranked_match_players where match_id=$1 and user_id=$2`,
    [matchId, LEOU]
  );
  const notif = await client.query(
    `select message from public.notifications where user_id=$1 and link_url = $2 order by created_at desc limit 1`,
    [LEOU, `/ranked/match/${matchId}`]
  );

  // Independently compute what the FULL (undiscounted) delta would have
  // been, from the exact same SQL helper functions apply_ranked_result()
  // calls — this is the same formula, not a re-derivation, so it isolates
  // exactly one thing: whether the discount factor was actually applied.
  // reliability_modifier uses a FRESHLY recomputed reliability
  // (ranked_reliability(match_count, days_since_last)), not the stored
  // value — apply_ranked_result() always recomputes it, same as it
  // always recomputes tier/pips. Mirroring that here, not the stored
  // column, is what makes this comparison exact rather than approximate.
  const leouMatchCount = leouBefore.rows[0].calibration_matches + leouBefore.rows[0].wins + leouBefore.rows[0].losses;
  const leouDaysSinceLast = leouBefore.rows[0].last_match_at === null ? null : 0;
  const expectedRaw = await client.query(
    `select
       public.ranked_k_factor(true) as k,
       public.ranked_expected_score($1, $2) as expected,
       public.ranked_match_weight('air_rally_ranked') as weight,
       public.ranked_reliability_modifier(public.ranked_reliability($3, $4)) as reliability_mod,
       public.ranked_recency_multiplier(0) as recency,
       public.ranked_max_delta(true) as cap`,
    [leouBefore.rows[0].rating, mobileBefore.rows[0].rating, leouMatchCount, leouDaysSinceLast]
  );
  const { k, expected, weight, reliability_mod, recency, cap } = expectedRaw.rows[0];
  const actualScore = 11 / (11 + 5);
  const gap = actualScore - Number(expected);
  const fullRaw = k * gap * Number(weight) * Number(reliability_mod) * Number(recency);
  const fullDelta = Math.max(-cap, Math.min(cap, Math.round(fullRaw)));
  const discountedRaw = fullRaw * 0.5;
  const expectedDiscountedDelta = Math.max(-cap, Math.min(cap, Math.round(discountedRaw)));

  console.log(`\nFull (undiscounted) delta would have been: ${fullDelta}`);
  console.log(`Expected discounted delta (half, same clamp): ${expectedDiscountedDelta}`);
  console.log(`Actual persisted delta: ${leouRow.rows[0].rating_delta}\n`);

  assertEqual("LEOU's rating_delta is the discounted (half) value, not the full one", leouRow.rows[0].rating_delta, expectedDiscountedDelta);
  assertEqual("LEOU's rating actually moved (not frozen)", leouAfter.rows[0].rating, leouBefore.rows[0].rating + expectedDiscountedDelta);
  assertEqual("LEOU's win was recorded", leouAfter.rows[0].wins, 6);
  assertEqual("LEOU's streak continued", leouAfter.rows[0].current_streak, 2);
  assertEqual("LEOU's calibration_matches untouched (already calibrated)", leouAfter.rows[0].calibration_matches, 10);
  assertEqual("booked_rated_matches did NOT increment for an unbooked match", leouAfter.rows[0].booked_rated_matches, 0);
  assertEqual("ranked_match_players row was written (not skipped)", leouRow.rows[0].tier_before !== null, true);
  assertEqual(
    "the result notification names the discount, not a freeze",
    notif.rows[0]?.message.includes("counts at half"),
    true
  );

  // ---- The adjacent claim: MOBILE (uncalibrated) is never discounted ----
  const mobileRow = await client.query(
    `select rating_delta from public.ranked_match_players where match_id=$1 and user_id=$2`,
    [matchId, MOBILE]
  );
  const mobileExpectedRaw = await client.query(
    `select
       public.ranked_k_factor(false) as k,
       public.ranked_expected_score($1, $2) as expected,
       public.ranked_match_weight('air_rally_ranked') as weight,
       public.ranked_reliability_modifier(public.ranked_reliability(3, null)) as reliability_mod,
       public.ranked_recency_multiplier(0) as recency,
       public.ranked_max_delta(false) as cap`,
    [mobileBefore.rows[0].rating, leouBefore.rows[0].rating]
  );
  const m = mobileExpectedRaw.rows[0];
  const mobileActualScore = 5 / (11 + 5);
  const mobileGap = mobileActualScore - Number(m.expected);
  const mobileRaw = m.k * mobileGap * Number(m.weight) * Number(m.reliability_mod) * Number(m.recency);
  const mobileExpectedDelta = Math.max(-m.cap, Math.min(m.cap, Math.round(mobileRaw)));
  assertEqual("MOBILE (uncalibrated) got the FULL delta, not discounted, despite being unbooked too", mobileRow.rows[0].rating_delta, mobileExpectedDelta);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
