/**
 * Proves the Open Match feature (20260810000115_cities.sql,
 * 20260810000116_open_matches.sql, extended by 20260810000119 with
 * scheduled_at/venue and scheduled_at-relative expiry) against a real
 * staging database, end to end through the actual RPCs — not by
 * inspecting table shape.
 *
 * Reuses the rating-engine suite's own fixture accounts (LEOU/MOBILE/3
 * SPARES) rather than inventing new ones, for the same reason that suite
 * gives: these are real, already-known accounts with real player_ranks
 * bootstrapping behavior, and reusing them means one fewer set of
 * Supabase-auth users to seed and keep alive.
 *
 * ⚠️ PUSH TOKENS: LEOU and MOBILE resolve to the founder's real email
 * addresses (see verify-ranked-rating-engine.ts's own extensive note on
 * this — a prior run of THAT suite pushed ~90 real notifications to the
 * founder's phone). create_open_match() broadcasts a real notification
 * row to every same-city profile, so this suite clears push tokens for
 * all five accounts before doing anything, same as that suite does.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-open-match.ts
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

async function assertRejects(label: string, expectedMessage: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`FAIL ${label}: expected rejection "${expectedMessage}", but it succeeded`);
    failures++;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ok = message.includes(expectedMessage);
    console.log(`${ok ? "OK  " : "FAIL"} ${label}: got error "${message}", want to include "${expectedMessage}"`);
    if (!ok) failures++;
  }
}

async function asUser(client: Client, userId: string, fn: () => Promise<unknown>) {
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

const LEOU = "86f6cb7c-3051-4db5-89e0-3d5443945304";
const MOBILE = "3e1c4aa5-2122-4343-a3e2-321c11961a74";
const SPARES = [
  "fbc1b5e4-8fcc-4d61-b937-e45a4b5e53dd",
  "366d3dcb-bb90-4342-b436-582eec652228",
  "a3a2d9b8-f169-4165-8a00-3caee5d9dc7b",
];
const [SPARE1, SPARE2, SPARE3] = SPARES;
const SUITE_ACCOUNTS = [LEOU, MOBILE, ...SPARES];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const clearedTokens = await client.query(
    `delete from public.device_push_tokens where user_id = any($1) returning user_id`,
    [SUITE_ACCOUNTS]
  );
  if (clearedTokens.rowCount) {
    console.log(`[setup] cleared ${clearedTokens.rowCount} device push token(s) — see the note in this file before "fixing" this.\n`);
  }

  // Clean slate. open_matches cascades to open_match_join_requests and
  // ranked_matches cascades to ranked_match_players via FK.
  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  // open_matches.converted_match_id references ranked_matches, so it has
  // to go first or a converted fixture from a prior run leaves a
  // dangling FK on the delete below.
  await client.query(`delete from public.open_matches where host_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.player_ranks where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`update public.profiles set city_slug = null where id = any($1)`, [SUITE_ACCOUNTS]);

  // Everyone except SPARE3 starts in the same city so the broadcast and
  // join flow has real players to work with; SPARE3 starts elsewhere to
  // prove the city guard, then gets moved in for the doubles case later.
  await client.query(`update public.profiles set city_slug = 'taguig' where id = any($1)`, [[MOBILE, SPARE1, SPARE2]]);
  await client.query(`update public.profiles set city_slug = 'cebu-city' where id = $1`, [SPARE3]);

  // -------------------------------------------------------------------
  console.log("\n=== create_open_match: broadcast reaches only the same city ===\n");

  let m1 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m1 = rows[0].id;
  });

  const leouCity = await client.query(`select city_slug from public.profiles where id = $1`, [LEOU]);
  assertEqual("host's own city_slug is set by creating the match", leouCity.rows[0].city_slug, "taguig");

  const broadcast = await client.query(
    `select user_id from public.notifications where type = 'open_match_found' and user_id = any($1)`,
    [[MOBILE, SPARE1, SPARE2, SPARE3]]
  );
  assertEqual(
    "broadcast reached exactly the same-city players, not SPARE3",
    broadcast.rows.map((r) => r.user_id).sort(),
    [MOBILE, SPARE1, SPARE2].sort()
  );

  await assertRejects(
    "a match scheduled in the past is rejected outright",
    "Pick a time in the future.",
    () => asUser(client, LEOU, () => client.query(`select public.create_open_match('taguig', now() - interval '1 hour')`))
  );

  // -------------------------------------------------------------------
  console.log("\n=== request_to_join_open_match: authorization and city guard ===\n");

  await assertRejects("a different-city player cannot request to join", "This match is for a different city.", () =>
    asUser(client, SPARE3, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  await assertRejects("the host cannot request to join their own match", "You are already hosting this match.", () =>
    asUser(client, LEOU, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  let r1 = "";
  await asUser(client, MOBILE, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m1]);
    r1 = rows[0].id;
  });

  await assertRejects("a duplicate request is rejected", "You already asked to join this match.", () =>
    asUser(client, MOBILE, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== decline, then a real retry is allowed (no permanent ban) ===\n");

  await assertRejects("only the host can decline", "Only the host can decline a request.", () =>
    asUser(client, MOBILE, () => client.query(`select public.decline_join_request($1)`, [r1]))
  );

  await asUser(client, LEOU, () => client.query(`select public.decline_join_request($1)`, [r1]));
  const declined = await client.query(`select status from public.open_match_join_requests where id = $1`, [r1]);
  assertEqual("declined request status", declined.rows[0].status, "declined");

  let r1b = "";
  await asUser(client, MOBILE, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m1]);
    r1b = rows[0].id;
  });
  assertEqual("a fresh request row is created on retry, not blocked by the old one", r1b !== r1, true);

  // -------------------------------------------------------------------
  console.log("\n=== accept, then start singles at exactly 2 ===\n");

  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r1b]));
  const count2 = await client.query(`select public.open_match_accepted_count($1) as n`, [m1]);
  assertEqual("accepted headcount after 1 accept (host + 1)", count2.rows[0].n, 2);

  await assertRejects("only the host can start the match", "Only the host can start this match.", () =>
    asUser(client, MOBILE, () => client.query(`select public.start_open_match_singles($1)`, [m1]))
  );

  let singlesMatchId = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.start_open_match_singles($1) as id`, [m1]);
    singlesMatchId = rows[0].id;
  });

  const m1After = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m1]);
  assertEqual("open match converted", m1After.rows[0].status, "converted");
  assertEqual("converted_match_id points at the real ranked match", m1After.rows[0].converted_match_id, singlesMatchId);

  const singlesPlayers = await client.query(
    `select user_id, team from public.ranked_match_players where match_id = $1 order by user_id`,
    [singlesMatchId]
  );
  assertEqual(
    "the ranked singles match has exactly host + the accepted player",
    singlesPlayers.rows.map((r) => r.user_id).sort(),
    [LEOU, MOBILE].sort()
  );
  const singlesType = await client.query(`select match_type from public.ranked_matches where id = $1`, [singlesMatchId]);
  assertEqual("converted match is singles", singlesType.rows[0].match_type, "singles");

  await assertRejects("a converted match can no longer take requests", "This match is no longer open.", () =>
    asUser(client, SPARE1, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== kick reduces the count; 3 accepted cannot start ===\n");

  let m2 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m2 = rows[0].id;
  });

  let r2 = "";
  await asUser(client, SPARE1, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m2]);
    r2 = rows[0].id;
  });
  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r2]));

  let r3 = "";
  await asUser(client, SPARE2, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m2]);
    r3 = rows[0].id;
  });
  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r3]));

  const count3 = await client.query(`select public.open_match_accepted_count($1) as n`, [m2]);
  assertEqual("accepted headcount at 3 (host + 2)", count3.rows[0].n, 3);

  await assertRejects(
    "3 accepted cannot start — no finalizing action exists at 3",
    "Need exactly one other player accepted to start singles.",
    () => asUser(client, LEOU, () => client.query(`select public.start_open_match_singles($1)`, [m2]))
  );

  await assertRejects("only the host can kick", "Only the host can remove a player.", () =>
    asUser(client, SPARE1, () => client.query(`select public.kick_accepted_player($1)`, [r2]))
  );

  await asUser(client, LEOU, () => client.query(`select public.kick_accepted_player($1)`, [r2]));
  const kicked = await client.query(`select status from public.open_match_join_requests where id = $1`, [r2]);
  assertEqual("kicked request status (distinct from declined)", kicked.rows[0].status, "kicked");

  const count2b = await client.query(`select public.open_match_accepted_count($1) as n`, [m2]);
  assertEqual("accepted headcount after kick (host + 1)", count2b.rows[0].n, 2);

  let singlesMatchId2 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.start_open_match_singles($1) as id`, [m2]);
    singlesMatchId2 = rows[0].id;
  });
  const singlesPlayers2 = await client.query(
    `select user_id from public.ranked_match_players where match_id = $1 order by user_id`,
    [singlesMatchId2]
  );
  assertEqual(
    "kicking freed the second slot for the remaining accepted player",
    singlesPlayers2.rows.map((r) => r.user_id).sort(),
    [LEOU, SPARE2].sort()
  );

  // -------------------------------------------------------------------
  console.log("\n=== withdraw is the requester's own action only; cancel cascades ===\n");

  let m3 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m3 = rows[0].id;
  });

  let r4 = "";
  await asUser(client, SPARE1, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m3]);
    r4 = rows[0].id;
  });

  await assertRejects("only the requester can withdraw their own request", "You can only withdraw your own request.", () =>
    asUser(client, SPARE2, () => client.query(`select public.withdraw_join_request($1)`, [r4]))
  );

  await asUser(client, SPARE1, () => client.query(`select public.withdraw_join_request($1)`, [r4]));
  const withdrawn = await client.query(`select status from public.open_match_join_requests where id = $1`, [r4]);
  assertEqual("withdrawn request status", withdrawn.rows[0].status, "withdrawn");

  let r5 = "";
  await asUser(client, SPARE2, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m3]);
    r5 = rows[0].id;
  });
  await asUser(client, LEOU, () => client.query(`select public.cancel_open_match($1)`, [m3]));

  const m3After = await client.query(`select status from public.open_matches where id = $1`, [m3]);
  assertEqual("cancelled match status", m3After.rows[0].status, "cancelled");
  const r5After = await client.query(`select status from public.open_match_join_requests where id = $1`, [r5]);
  assertEqual("a still-pending request is declined when the host cancels", r5After.rows[0].status, "declined");

  // -------------------------------------------------------------------
  console.log("\n=== auto-convert at exactly 4: exact team pairing, pending request declined ===\n");

  await client.query(`update public.profiles set city_slug = 'taguig' where id = $1`, [SPARE3]);

  let m4 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m4 = rows[0].id;
  });

  let r6 = "";
  await asUser(client, MOBILE, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m4]);
    r6 = rows[0].id;
  });
  let r7 = "";
  await asUser(client, SPARE1, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m4]);
    r7 = rows[0].id;
  });
  let r8 = "";
  await asUser(client, SPARE2, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m4]);
    r8 = rows[0].id;
  });
  // SPARE3 requests but will still be pending when the 4th slot fills
  // from the other three — this is the case that must auto-decline.
  let r9 = "";
  await asUser(client, SPARE3, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m4]);
    r9 = rows[0].id;
  });

  // Exact ratings from the design memory's own worked example: the
  // {lowest,highest} vs {two middles} pairing gives a 100-point gap here
  // (2400 vs 2300) against 500 and 300 for the alternatives.
  await client.query(
    `update public.player_ranks set rating = case user_id
       when $1 then 1000 when $2 then 1100 when $3 then 1200 when $4 then 1400 end
     where user_id = any($5) and season_id = public.current_ranked_season()`,
    [LEOU, MOBILE, SPARE1, SPARE2, [LEOU, MOBILE, SPARE1, SPARE2]]
  );

  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r6]));
  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r7]));
  await asUser(client, LEOU, () => client.query(`select public.accept_join_request($1)`, [r8]));

  const m4After = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m4]);
  assertEqual("open match auto-converted at exactly 4", m4After.rows[0].status, "converted");
  const doublesMatchId = m4After.rows[0].converted_match_id;

  const r9After = await client.query(`select status from public.open_match_join_requests where id = $1`, [r9]);
  assertEqual("the still-pending 4th requester is declined by the fill, not left dangling", r9After.rows[0].status, "declined");

  const doublesType = await client.query(`select match_type from public.ranked_matches where id = $1`, [doublesMatchId]);
  assertEqual("converted match is doubles", doublesType.rows[0].match_type, "doubles");

  const doublesTeams = await client.query(
    `select user_id, team from public.ranked_match_players where match_id = $1 order by team, user_id`,
    [doublesMatchId]
  );
  const teamA = doublesTeams.rows.filter((r) => r.team === "a").map((r) => r.user_id).sort();
  const teamB = doublesTeams.rows.filter((r) => r.team === "b").map((r) => r.user_id).sort();
  assertEqual("team A is {lowest, highest} rating — LEOU(1000) + SPARE2(1400)", teamA, [LEOU, SPARE2].sort());
  assertEqual("team B is the two middle ratings — MOBILE(1100) + SPARE1(1200)", teamB, [MOBILE, SPARE1].sort());

  // -------------------------------------------------------------------
  console.log("\n=== rank-gap cap: named error, not a generic failure ===\n");

  let m7 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m7 = rows[0].id;
  });
  await client.query(
    `update public.player_ranks set is_calibrated = true, rating = 800
     where user_id = $1 and season_id = public.current_ranked_season()`,
    [LEOU]
  );
  await client.query(
    `update public.player_ranks set is_calibrated = true, rating = 1800
     where user_id = $1 and season_id = public.current_ranked_season()`,
    [MOBILE]
  );

  await assertRejects(
    "a 1000-point gap (> 350) is rejected with the founder's exact copy",
    "You cannot party/play with this player, rank gap is too high.",
    () => asUser(client, MOBILE, () => client.query(`select public.request_to_join_open_match($1)`, [m7]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== expiry sweep: relative to scheduled_at, not created_at ===\n");

  // Scheduled 90 minutes ago (kickoff already passed) — must expire
  // regardless of how recently it was CREATED.
  let m5 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m5 = rows[0].id;
  });
  let r10 = "";
  await asUser(client, SPARE1, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [m5]);
    r10 = rows[0].id;
  });
  await client.query(`update public.open_matches set scheduled_at = now() - interval '90 minutes' where id = $1`, [m5]);

  // Scheduled 1 day out — the direct Tuesday-posted/Saturday-game case.
  // Must survive even if it were created long ago, so back-date
  // created_at here specifically to prove the sweep no longer looks at
  // it at all.
  let m6 = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    m6 = rows[0].id;
  });
  await client.query(`update public.open_matches set created_at = now() - interval '5 days' where id = $1`, [m6]);

  await client.query(`select public.expire_stale_open_matches()`);

  const m5After = await client.query(`select status from public.open_matches where id = $1`, [m5]);
  assertEqual("a match whose scheduled_at has passed expires", m5After.rows[0].status, "expired");
  const r10After = await client.query(`select status from public.open_match_join_requests where id = $1`, [r10]);
  assertEqual("its pending request is declined by the sweep", r10After.rows[0].status, "declined");
  const m6After = await client.query(`select status from public.open_matches where id = $1`, [m6]);
  assertEqual(
    "a match posted 5 days ago but scheduled for tomorrow survives — created_at is irrelevant now",
    m6After.rows[0].status,
    "open"
  );

  // -------------------------------------------------------------------
  console.log("\n=== teardown ===\n");
  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  // open_matches.converted_match_id references ranked_matches, so it has
  // to go first or a converted fixture from a prior run leaves a
  // dangling FK on the delete below.
  await client.query(`delete from public.open_matches where host_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.player_ranks where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`update public.profiles set city_slug = null where id = any($1)`, [SUITE_ACCOUNTS]);
  console.log("fixtures cleaned up.");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
