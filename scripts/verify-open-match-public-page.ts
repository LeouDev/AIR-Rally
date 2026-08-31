/**
 * Companion to verify-open-match-public.ts, one layer up: that script
 * proved get_open_match_public() as the real `anon` role; this one
 * proves the actual Next.js page renders it correctly — noindex,
 * no cookies, the right copy per status, and no requester identity
 * anywhere in the rendered payload. Same fixture technique (direct SQL,
 * not create_open_match(), so nothing broadcasts to a real city and
 * nothing touches player_ranks), same safety guard.
 *
 * Split into two phases instead of one create-test-delete script,
 * because the "test" step here is a real browser hit against a running
 * `next dev` server, not something this process can do itself:
 *
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-open-match-public-page.ts create
 *   ... hit /ranked/open/<id> for each printed id ...
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-open-match-public-page.ts cleanup <id> <id> ...
 *
 * (after sourcing .env.staging).
 *
 * Covers 'expired' in addition to the three verify-open-match-public.ts
 * already checked at the RPC layer — the page has its own copy for it
 * that script had no reason to exercise.
 */
import "./assert-staging-env";
import { Client } from "pg";

const HOST = "86f6cb7c-3051-4db5-89e0-3d5443945304"; // LEOU, same fixture host as verify-open-match-public.ts
const CITY = "taguig";

async function create() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const statuses = ["open", "converted", "expired", "cancelled"] as const;
  const ids: Record<string, string> = {};
  for (const status of statuses) {
    const result = await client.query(
      `insert into public.open_matches (host_id, target_city, status) values ($1, $2, $3) returning id`,
      [HOST, CITY, status]
    );
    ids[status] = result.rows[0].id;
  }

  console.log("\nFixtures created — hit each of these against the running dev server:\n");
  for (const status of statuses) {
    console.log(`  ${status.padEnd(10)} /ranked/open/${ids[status]}`);
  }
  console.log(`\nWhen done, clean up with:\n  ... cleanup ${Object.values(ids).join(" ")}\n`);

  await client.end();
}

async function cleanup(ids: string[]) {
  if (ids.length === 0) {
    console.error("cleanup: no ids given.");
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const before = await client.query(`select count(*)::int as n from public.open_matches where id = any($1)`, [ids]);
  const deleted = await client.query(`delete from public.open_matches where id = any($1) returning id`, [ids]);
  const remaining = await client.query(`select count(*)::int as n from public.open_matches where id = any($1)`, [ids]);

  console.log(`before: ${before.rows[0].n} fixture row(s) present`);
  console.log(`deleted: ${deleted.rowCount}`);
  console.log(`after: ${remaining.rows[0].n} fixture row(s) remaining (must be 0)`);

  if (remaining.rows[0].n !== 0) {
    console.error("CLEANUP DID NOT FULLY REMOVE FIXTURES.");
    await client.end();
    process.exit(1);
  }
  console.log("cleanup verified clean.");
  await client.end();
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode === "create") return create();
  if (mode === "cleanup") return cleanup(rest);
  console.error('Usage: verify-open-match-public-page.ts create|cleanup [ids...]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
