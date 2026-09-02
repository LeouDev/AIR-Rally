/**
 * Sets up four real Open Match fixtures via the actual RPCs (not direct
 * inserts) with scheduled_at backdated into the past, then deliberately
 * does NOT call resolve_open_matches_at_kickoff() itself. The point is
 * to observe the REAL pg_cron job (every 5 min) pick them up on its own
 * next tick — "the cron fires" as a behavioral fact, not "the function
 * works when I call it" (already proven separately in verify-open-match.ts).
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/audit-kickoff-cron-setup.ts
 * (after sourcing .env.staging). Then wait for the next 5-minute cron
 * tick and run audit-kickoff-cron-check.ts.
 */
import "./assert-staging-env";
import { Client } from "pg";

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

async function createMatch(client: Client): Promise<string> {
  let id = "";
  await asUser(client, LEOU, async () => {
    const { rows } = await client.query(`select public.create_open_match('taguig', now() + interval '1 day') as id`);
    id = rows[0].id;
  });
  return id;
}

async function join(client: Client, user: string, matchId: string) {
  await asUser(client, user, () => client.query(`select public.request_to_join_open_match($1)`, [matchId]));
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`delete from public.notifications where user_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.open_matches where host_id = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`delete from public.ranked_matches where created_by = any($1)`, [SUITE_ACCOUNTS]);
  await client.query(`update public.profiles set city_slug = 'taguig' where id = any($1)`, [[LEOU, MOBILE, SPARE1, SPARE2, SPARE3]]);

  // A: 1 accepted (host only) — must expire.
  const matchA = await createMatch(client);

  // B: 2 accepted, never manually started — must auto-start (singles).
  const matchB = await createMatch(client);
  await join(client, MOBILE, matchB);

  // C: 3 accepted — unstartable, must expire.
  const matchC = await createMatch(client);
  await join(client, MOBILE, matchC);
  await join(client, SPARE1, matchC);

  // D: 4 accepted, never manually started — must auto-start (doubles).
  const matchD = await createMatch(client);
  await join(client, MOBILE, matchD);
  await join(client, SPARE1, matchD);
  await join(client, SPARE2, matchD);

  // Backdate all four past their scheduled kickoff — real state, just
  // time-shifted, exactly what the live cron will find on its own.
  await client.query(
    `update public.open_matches set scheduled_at = now() - interval '2 minutes' where id = any($1)`,
    [[matchA, matchB, matchC, matchD]]
  );

  console.log("Fixtures created, scheduled_at backdated. NOT calling resolve_open_matches_at_kickoff().");
  console.log(JSON.stringify({ matchA, matchB, matchC, matchD }, null, 2));
  console.log("\nWait for the next real cron tick (every 5 min, check cron.job_run_details), then run audit-kickoff-cron-check.ts with these ids.");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
