/**
 * Proves expire_stalled_ranked_matches() (20260810000114) against a real
 * staging database — both halves of it.
 *
 * A sweep that only demonstrates what it CATCHES is half a test. The
 * cases that must SURVIVE are the ones with something to lose:
 *
 *   * `awaiting_confirmation` — the match was played and the score
 *     submitted. Sweeping it destroys a real result and a real rating
 *     change, and would look like tidying up.
 *   * a `live` match WITH recorded rallies — interrupted, not abandoned.
 *     This case exists only because the sweep discriminates on rally
 *     count rather than age; nothing else would cover it.
 *
 * Every fixture is created directly rather than played through the RPCs:
 * the sweep reads only `status`, `created_at`/`started_at` and the
 * presence of `ranked_match_points` rows, so constructing that state is
 * both sufficient and far clearer than driving a match to it. Ages are
 * set by backdating timestamps rather than waiting.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-ranked-match-sweep.ts
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

const HOST = "86f6cb7c-3051-4db5-89e0-3d5443945304";
const OPP = "3e1c4aa5-2122-4343-a3e2-321c11961a74";
const TAG = "sweep-fixture";

type Case = {
  name: string;
  status: string;
  ageMinutes: number;
  rallies: number;
  shouldSweep: boolean;
  why: string;
};

const CASES: Case[] = [
  // --- must be swept ---
  { name: "lobby, 2h old", status: "lobby", ageMinutes: 120, rallies: 0, shouldSweep: true,
    why: "past the 1h window, nobody committed anything" },
  { name: "officiating, 3h old", status: "officiating", ageMinutes: 180, rallies: 0, shouldSweep: true,
    why: "past the 2h window, everyone readied but nothing started" },
  { name: "live, 30h old, NO rallies", status: "live", ageMinutes: 1800, rallies: 0, shouldSweep: true,
    why: "abandoned — tapped through officiating and walked away" },

  // --- must survive ---
  { name: "lobby, 10min old", status: "lobby", ageMinutes: 10, rallies: 0, shouldSweep: false,
    why: "inside the window; a real lobby waiting on players" },
  { name: "officiating, 30min old", status: "officiating", ageMinutes: 30, rallies: 0, shouldSweep: false,
    why: "inside the window" },
  { name: "live, 30h old, WITH rallies", status: "live", ageMinutes: 1800, rallies: 8, shouldSweep: false,
    why: "INTERRUPTED, not abandoned — real scoring work would be destroyed" },
  { name: "awaiting_confirmation, 30h old", status: "awaiting_confirmation", ageMinutes: 1800, rallies: 11, shouldSweep: false,
    why: "played and submitted; only an accept is missing. Must NEVER be swept" },
  { name: "awaiting_confirmation, 90 DAYS old", status: "awaiting_confirmation", ageMinutes: 129600, rallies: 11, shouldSweep: false,
    why: "no amount of age makes a submitted result sweepable" },
  { name: "confirmed, 30h old", status: "confirmed", ageMinutes: 1800, rallies: 11, shouldSweep: false,
    why: "terminal" },
  { name: "disputed, 30h old", status: "disputed", ageMinutes: 1800, rallies: 11, shouldSweep: false,
    why: "terminal — and a dispute waiting on an admin must not vanish" },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const season = (await client.query(`select public.current_ranked_season() as id`)).rows[0].id;

  // Clean slate — identified by the tag, so this never touches anything
  // it did not create.
  await client.query(
    `delete from public.ranked_matches where dispute_reason = $1 or id in (
       select match_id from public.ranked_match_players where match_id in (
         select id from public.ranked_matches where dispute_reason = $1))`, [TAG]);

  const ids: Record<string, string> = {};
  for (const cse of CASES) {
    const m = await client.query(
      `insert into public.ranked_matches
         (season_id, match_type, status, rated, scoring_mode, created_by, dispute_reason,
          score_a, score_b, winning_team, created_at, started_at)
       values ($1,'singles',$2,true,'rally',$3,$4,
               $5,$6,$7,
               now() - make_interval(mins => $8), now() - make_interval(mins => $8))
       returning id`,
      [season, cse.status, HOST, TAG,
       cse.rallies ? 11 : 0, cse.rallies ? 2 : 0,
       ["confirmed","disputed","awaiting_confirmation"].includes(cse.status) ? "a" : null,
       cse.ageMinutes]);
    const id = m.rows[0].id;
    ids[cse.name] = id;
    await client.query(
      `insert into public.ranked_match_players (match_id, user_id, team, is_host, ready)
       values ($1,$2,'a',true,true), ($1,$3,'b',false,true)`, [id, HOST, OPP]);
    for (let i = 1; i <= cse.rallies; i++) {
      await client.query(
        `insert into public.ranked_match_points (match_id, seq, team, recorded_by)
         values ($1,$2,$3,$4)`, [id, i, i % 4 === 0 ? "b" : "a", HOST]);
    }
  }

  console.log(`\nseeded ${CASES.length} fixtures\n`);

  const swept = await client.query(`select public.expire_stalled_ranked_matches() as n`);
  console.log(`expire_stalled_ranked_matches() swept ${swept.rows[0].n} match(es)\n`);

  console.log("--- must be swept ---");
  for (const cse of CASES.filter((c) => c.shouldSweep)) {
    const r = await client.query(
      `select status, expired_at is not null as marked from public.ranked_matches where id=$1`, [ids[cse.name]]);
    assertEqual(`${cse.name} → cancelled (${cse.why})`,
      { status: r.rows[0].status, marked: r.rows[0].marked },
      { status: "cancelled", marked: true });
  }

  console.log("\n--- must SURVIVE (the half that matters) ---");
  for (const cse of CASES.filter((c) => !c.shouldSweep)) {
    const r = await client.query(
      `select status, expired_at is not null as marked from public.ranked_matches where id=$1`, [ids[cse.name]]);
    assertEqual(`${cse.name} → untouched (${cse.why})`,
      { status: r.rows[0].status, marked: r.rows[0].marked },
      { status: cse.status, marked: false });
  }

  // A swept match must remain readable by a shipped client: `cancelled` is
  // a status build 9 already renders. This asserts we did not invent a
  // value the fleet cannot handle.
  const values = await client.query(
    `select distinct status from public.ranked_matches where expired_at is not null`);
  assertEqual("every swept match uses a status shipped clients already render",
    values.rows.map((r) => r.status), ["cancelled"]);

  // No notification rows: a bulk sweep must not become bulk mail.
  const notifs = await client.query(
    `select count(*)::int as n from public.notifications
     where created_at > now() - interval '2 minutes' and type like 'ranked%'`);
  assertEqual("the sweep created no notifications", notifs.rows[0].n, 0);

  await client.query(`delete from public.ranked_matches where dispute_reason = $1`, [TAG]);
  console.log("\nfixtures cleaned up.");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
