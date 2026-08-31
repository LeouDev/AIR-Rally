/**
 * Proves the Open Match feature end to end against a real staging
 * database, through the actual RPCs — not by inspecting table shape.
 * Covers 115/116 (schema), 117 (rank-gap cap), 119 (scheduled/venue),
 * and 120 (auto-accept, the create_ranked_match auth-boundary split,
 * kickoff-relative conversion/expiry).
 *
 * Reuses the rating-engine suite's own fixture accounts (LEOU/MOBILE/3
 * SPARES) rather than inventing new ones — see that suite's own
 * comments for why, and for the push-token-clearing requirement this
 * suite also follows (create_open_match broadcasts real notifications).
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
    const result = await fn();
    await client.query("commit");
    return result;
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

async function createMatch(client: Client, host: string, hoursOut = 24): Promise<string> {
  let id = "";
  await asUser(client, host, async () => {
    const { rows } = await client.query(
      `select public.create_open_match('taguig', now() + make_interval(hours => $1)) as id`,
      [hoursOut]
    );
    id = rows[0].id;
  });
  return id;
}

async function join(client: Client, user: string, matchId: string): Promise<string> {
  let id = "";
  await asUser(client, user, async () => {
    const { rows } = await client.query(`select public.request_to_join_open_match($1) as id`, [matchId]);
    id = rows[0].id;
  });
  return id;
}

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

  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.open_matches where host_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.player_ranks where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`update public.profiles set city_slug = null where id = any($1)`, [SUITE_ACCOUNTS]);
  // SPARE3 starts in a different city so the city-guard test has a real
  // mismatch to prove; moved into 'taguig' later once that's covered.
  await client.query(`update public.profiles set city_slug = 'taguig' where id = any($1)`, [[MOBILE, SPARE1, SPARE2]]);
  await client.query(`update public.profiles set city_slug = 'cebu-city' where id = $1`, [SPARE3]);

  // -------------------------------------------------------------------
  console.log("\n=== create_open_match: broadcast, and the past-time guard ===\n");

  const m1 = await createMatch(client, LEOU);
  const leouCity = await client.query(`select city_slug from public.profiles where id = $1`, [LEOU]);
  assertEqual("host's own city_slug is set by creating the match", leouCity.rows[0].city_slug, "taguig");

  const broadcast = await client.query(
    `select user_id from public.notifications where type = 'open_match_found' and user_id = any($1)`,
    [[MOBILE, SPARE1, SPARE2, SPARE3]]
  );
  assertEqual(
    "broadcast reached every same-city player, not SPARE3 (different city)",
    broadcast.rows.map((r) => r.user_id).sort(),
    [MOBILE, SPARE1, SPARE2].sort()
  );

  await assertRejects(
    "a match scheduled in the past is rejected outright",
    "Pick a time in the future.",
    () => asUser(client, LEOU, () => client.query(`select public.create_open_match('taguig', now() - interval '1 hour')`))
  );

  // -------------------------------------------------------------------
  console.log("\n=== auto-accept: joining IS accepting, no separate host step ===\n");

  await assertRejects("a different-city player cannot request to join", "This match is for a different city.", () =>
    asUser(client, SPARE3, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );
  await client.query(`update public.profiles set city_slug = 'cebu-city' where id = $1`, [SPARE3]);

  await assertRejects("the host cannot request to join their own match", "You are already hosting this match.", () =>
    asUser(client, LEOU, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  const r1 = await join(client, MOBILE, m1);
  const r1Row = await client.query(`select status from public.open_match_join_requests where id = $1`, [r1]);
  assertEqual("the request is accepted immediately, no pending state", r1Row.rows[0].status, "accepted");

  await assertRejects("a second request from the same accepted player is rejected", "You already asked to join this match.", () =>
    asUser(client, MOBILE, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  assertEqual("accept_join_request no longer exists", await functionExists(client, "accept_join_request"), false);
  assertEqual("decline_join_request no longer exists", await functionExists(client, "decline_join_request"), false);

  // -------------------------------------------------------------------
  console.log("\n=== start singles manually at exactly 2 ===\n");

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
    `select user_id, is_host from public.ranked_match_players where match_id = $1 order by user_id`,
    [singlesMatchId]
  );
  assertEqual(
    "the ranked singles match has exactly host + the accepted player",
    singlesPlayers.rows.map((r) => r.user_id).sort(),
    [LEOU, MOBILE].sort()
  );
  assertEqual(
    "the OPEN MATCH HOST is is_host on the resulting match, not whoever happened to call start",
    singlesPlayers.rows.find((r) => r.user_id === LEOU)?.is_host,
    true
  );
  const singlesRanked = await client.query(`select created_by, match_type from public.ranked_matches where id = $1`, [singlesMatchId]);
  assertEqual("created_by is the open-match host", singlesRanked.rows[0].created_by, LEOU);
  assertEqual("converted match is singles", singlesRanked.rows[0].match_type, "singles");

  await assertRejects("a converted match can no longer take requests", "This match is no longer open.", () =>
    asUser(client, SPARE1, () => client.query(`select public.request_to_join_open_match($1)`, [m1]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== kick reduces the count; 3 accepted cannot start ===\n");

  const m2 = await createMatch(client, LEOU);
  const r2 = await join(client, SPARE1, m2);
  const r3 = await join(client, SPARE2, m2);

  const count3 = await client.query(`select public.open_match_accepted_count($1) as n`, [m2]);
  assertEqual("accepted headcount at 3 (host + 2)", count3.rows[0].n, 3);

  await assertRejects(
    "3 accepted cannot start singles",
    "Need exactly one other player accepted to start singles.",
    () => asUser(client, LEOU, () => client.query(`select public.start_open_match_singles($1)`, [m2]))
  );
  await assertRejects(
    "3 accepted cannot start full either",
    "Need exactly four players accepted to start now.",
    () => asUser(client, LEOU, () => client.query(`select public.start_open_match_full($1)`, [m2]))
  );

  await assertRejects("only the host can kick", "Only the host can remove a player.", () =>
    asUser(client, SPARE1, () => client.query(`select public.kick_accepted_player($1)`, [r2]))
  );

  await asUser(client, LEOU, () => client.query(`select public.kick_accepted_player($1)`, [r2]));
  const kicked = await client.query(`select status from public.open_match_join_requests where id = $1`, [r2]);
  assertEqual("kicked request status (distinct from withdrawn)", kicked.rows[0].status, "kicked");

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
  void r3;

  // -------------------------------------------------------------------
  console.log("\n=== withdraw is the requester's own action only; cancel declines the rest ===\n");

  const m3 = await createMatch(client, LEOU);
  const r4 = await join(client, SPARE1, m3);

  await assertRejects("only the requester can withdraw their own request", "You can only withdraw your own request.", () =>
    asUser(client, SPARE2, () => client.query(`select public.withdraw_join_request($1)`, [r4]))
  );

  await asUser(client, SPARE1, () => client.query(`select public.withdraw_join_request($1)`, [r4]));
  const withdrawn = await client.query(`select status from public.open_match_join_requests where id = $1`, [r4]);
  assertEqual("withdrawn request status", withdrawn.rows[0].status, "withdrawn");

  const r5 = await join(client, SPARE2, m3);
  await asUser(client, LEOU, () => client.query(`select public.cancel_open_match($1)`, [m3]));

  const m3After = await client.query(`select status from public.open_matches where id = $1`, [m3]);
  assertEqual("cancelled match status", m3After.rows[0].status, "cancelled");
  const r5After = await client.query(`select status from public.open_match_join_requests where id = $1`, [r5]);
  assertEqual("an accepted request is declined when the host cancels", r5After.rows[0].status, "declined");

  // -------------------------------------------------------------------
  console.log("\n=== reaching 4 does NOT convert — it just closes the match ===\n");

  await client.query(`update public.profiles set city_slug = 'taguig' where id = $1`, [SPARE3]);

  const m4 = await createMatch(client, LEOU);
  const r6 = await join(client, MOBILE, m4);
  const r7 = await join(client, SPARE1, m4);

  await client.query(
    `update public.player_ranks set rating = case user_id
       when $1 then 1000 when $2 then 1100 when $3 then 1200 when $4 then 1400 end
     where user_id = any($5) and season_id = public.current_ranked_season()`,
    [LEOU, MOBILE, SPARE1, SPARE2, [LEOU, MOBILE, SPARE1, SPARE2]]
  );

  const r8 = await join(client, SPARE2, m4);

  const m4After = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m4]);
  assertEqual(
    "the 4th join does NOT convert — converting at fill would lock four people out of ranked play for days",
    m4After.rows[0].status,
    "open"
  );
  assertEqual("no ranked match exists yet", m4After.rows[0].converted_match_id, null);
  assertEqual("accepted headcount is 4", (await client.query(`select public.open_match_accepted_count($1) as n`, [m4])).rows[0].n, 4);

  await assertRejects("a match already at 4 rejects a 5th request as full", "This match is full.", () =>
    asUser(client, SPARE3, () => client.query(`select public.request_to_join_open_match($1)`, [m4]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== manual start-at-4: four people already there, don't make them wait ===\n");

  await assertRejects("only the host can start a full match early", "Only the host can start this match.", () =>
    asUser(client, MOBILE, () => client.query(`select public.start_open_match_full($1)`, [m4]))
  );

  let doublesMatchId = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.start_open_match_full($1) as id`, [m4]);
    doublesMatchId = rows[0].id;
  });

  const m4AfterStart = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m4]);
  assertEqual("the full match converts once the host manually starts it", m4AfterStart.rows[0].status, "converted");
  assertEqual("converted_match_id points at the real match", m4AfterStart.rows[0].converted_match_id, doublesMatchId);

  const doublesRanked = await client.query(`select created_by, match_type from public.ranked_matches where id = $1`, [doublesMatchId]);
  assertEqual("created_by is the open-match host, not whoever the 4th joiner happened to be", doublesRanked.rows[0].created_by, LEOU);
  assertEqual("converted match is doubles", doublesRanked.rows[0].match_type, "doubles");

  const doublesTeams = await client.query(
    `select user_id, team, is_host from public.ranked_match_players where match_id = $1 order by team, user_id`,
    [doublesMatchId]
  );
  const teamA = doublesTeams.rows.filter((r) => r.team === "a").map((r) => r.user_id).sort();
  const teamB = doublesTeams.rows.filter((r) => r.team === "b").map((r) => r.user_id).sort();
  assertEqual("team A is {lowest, highest} rating — LEOU(1000) + SPARE2(1400)", teamA, [LEOU, SPARE2].sort());
  assertEqual("team B is the two middle ratings — MOBILE(1100) + SPARE1(1200)", teamB, [MOBILE, SPARE1].sort());
  assertEqual(
    "the open-match host is_host on the resulting match",
    doublesTeams.rows.find((r) => r.user_id === LEOU)?.is_host,
    true
  );
  void r6;
  void r7;
  void r8;

  await assertRejects(
    "start_open_match_full rejects a match that's already converted",
    "This match is no longer open.",
    () => asUser(client, LEOU, () => client.query(`select public.start_open_match_full($1)`, [m4]))
  );

  // -------------------------------------------------------------------
  console.log("\n=== the row lock actually serializes concurrent joins on the same match ===\n");

  const m10 = await createMatch(client, LEOU);
  const lockHolder = new Client({ connectionString: process.env.DATABASE_URL });
  await lockHolder.connect();
  await lockHolder.query("begin");
  await lockHolder.query(`select * from public.open_matches where id = $1 for update`, [m10]);

  const blockedClient = new Client({ connectionString: process.env.DATABASE_URL });
  await blockedClient.connect();
  let blockedResolved = false;
  const blockedPromise = (async () => {
    await blockedClient.query("begin");
    await blockedClient.query(`select set_config('request.jwt.claim.sub', $1, true)`, [MOBILE]);
    await blockedClient.query(`select set_config('role', 'authenticated', true)`);
    await blockedClient.query(`select public.request_to_join_open_match($1)`, [m10]);
    await blockedClient.query("commit");
    blockedResolved = true;
  })();

  await new Promise((resolve) => setTimeout(resolve, 800));
  assertEqual("a concurrent join on the SAME match is still blocked 800ms later, not racing ahead", blockedResolved, false);

  await lockHolder.query("commit");
  await blockedPromise;
  assertEqual("the blocked join completes once the lock is released", blockedResolved, true);
  await lockHolder.end();
  await blockedClient.end();

  // -------------------------------------------------------------------
  console.log("\n=== rank-gap cap: named error, not a generic failure ===\n");

  const m7 = await createMatch(client, LEOU);
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
  console.log("\n=== kickoff sweep: convert if startable, expire if not, survive if not due ===\n");

  // 1 accepted (host only), kickoff passed — unstartable, expires.
  const m5 = await createMatch(client, LEOU);
  await client.query(`update public.open_matches set scheduled_at = now() - interval '5 minutes' where id = $1`, [m5]);

  // 2 accepted, never manually started, kickoff passed — auto-starts.
  const m6 = await createMatch(client, LEOU);
  const r10 = await join(client, SPARE1, m6);
  void r10;
  await client.query(`update public.open_matches set scheduled_at = now() - interval '5 minutes' where id = $1`, [m6]);

  // 3 accepted, kickoff passed — unstartable, expires.
  const m11 = await createMatch(client, LEOU);
  const r11a = await join(client, SPARE1, m11);
  const r11b = await join(client, SPARE2, m11);
  void r11a;
  await client.query(`update public.open_matches set scheduled_at = now() - interval '5 minutes' where id = $1`, [m11]);

  // 4 accepted, never manually started — the actual common case now
  // that reaching 4 doesn't auto-convert. Kickoff passed — auto-starts.
  const m13 = await createMatch(client, LEOU);
  const r13a = await join(client, SPARE1, m13);
  const r13b = await join(client, SPARE2, m13);
  const r13c = await join(client, SPARE3, m13);
  void r13a;
  void r13b;
  void r13c;
  await client.query(`update public.player_ranks set rating = 1000 where user_id = $1 and season_id = public.current_ranked_season()`, [LEOU]);
  await client.query(`update public.open_matches set scheduled_at = now() - interval '5 minutes' where id = $1`, [m13]);

  // Fresh, not due yet — must survive untouched.
  const m12 = await createMatch(client, LEOU);

  await client.query(`select public.resolve_open_matches_at_kickoff()`);

  const m5After = await client.query(`select status from public.open_matches where id = $1`, [m5]);
  assertEqual("1 accepted at kickoff expires", m5After.rows[0].status, "expired");

  const m6After = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m6]);
  assertEqual("2 accepted, never manually started, auto-converts AT kickoff", m6After.rows[0].status, "converted");
  const m6Players = await client.query(
    `select user_id from public.ranked_match_players where match_id = $1 order by user_id`,
    [m6After.rows[0].converted_match_id]
  );
  assertEqual("the kickoff-converted singles match has the right two players", m6Players.rows.map((r) => r.user_id).sort(), [LEOU, SPARE1].sort());

  const m11After = await client.query(`select status from public.open_matches where id = $1`, [m11]);
  assertEqual("3 accepted at kickoff expires (unstartable)", m11After.rows[0].status, "expired");
  const r11bAfter = await client.query(`select status from public.open_match_join_requests where id = $1`, [r11b]);
  assertEqual("its accepted requests are untouched by the sweep (not declined — they just didn't get to play)", r11bAfter.rows[0].status, "accepted");

  const m12After = await client.query(`select status from public.open_matches where id = $1`, [m12]);
  assertEqual("a match not yet due survives the sweep", m12After.rows[0].status, "open");

  const m13After = await client.query(`select status, converted_match_id from public.open_matches where id = $1`, [m13]);
  assertEqual("4 accepted, never manually started, auto-starts AT kickoff — the common real-world path now", m13After.rows[0].status, "converted");
  const m13Players = await client.query(
    `select count(*)::int as n from public.ranked_match_players where match_id = $1`,
    [m13After.rows[0].converted_match_id]
  );
  assertEqual("the kickoff-converted doubles match has four players", m13Players.rows[0].n, 4);

  // -------------------------------------------------------------------
  console.log("\n=== teardown ===\n");
  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.open_matches where host_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.player_ranks where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`update public.profiles set city_slug = null where id = any($1)`, [SUITE_ACCOUNTS]);
  console.log("fixtures cleaned up.");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

async function functionExists(client: Client, name: string): Promise<boolean> {
  const r = await client.query(`select count(*)::int as n from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [name]);
  return r.rows[0].n > 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
