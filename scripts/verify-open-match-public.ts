/**
 * Proves get_open_match_public() (20260810000118) against staging,
 * called as the real `anon` role — not the service connection — since
 * that's the actual caller a signed-out visitor's browser produces.
 * Same verification shape as public-ranked-match-pages.md: apply, call
 * as anon, check exactly what comes back and what doesn't.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-open-match-public.ts
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

async function asAnon(client: Client, fn: () => Promise<unknown>) {
  await client.query("begin");
  try {
    await client.query(`select set_config('role', 'anon', true)`);
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

const HOST = "86f6cb7c-3051-4db5-89e0-3d5443945304"; // LEOU
const OPP = "3e1c4aa5-2122-4343-a3e2-321c11961a74"; // MOBILE
// target_city FKs to public.cities(slug), so this has to be a real
// city — 'taguig' is one of the founder's own venue cities. Fixtures
// are tracked by id and deleted explicitly in teardown rather than by
// a tag column, since open_matches has none.
const CITY = "taguig";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const fixtureIds: string[] = [];

  const openMatch = await client.query(
    `insert into public.open_matches (host_id, target_city, status) values ($1, $2, 'open') returning id`,
    [HOST, CITY]
  );
  const openId = openMatch.rows[0].id;
  fixtureIds.push(openId);
  await client.query(
    `insert into public.open_match_join_requests (open_match_id, user_id, status) values ($1, $2, 'accepted')`,
    [openId, OPP]
  );

  const convertedMatch = await client.query(
    `insert into public.open_matches (host_id, target_city, status) values ($1, $2, 'converted') returning id`,
    [HOST, CITY]
  );
  const convertedId = convertedMatch.rows[0].id;
  fixtureIds.push(convertedId);

  const cancelledMatch = await client.query(
    `insert into public.open_matches (host_id, target_city, status) values ($1, $2, 'cancelled') returning id`,
    [HOST, CITY]
  );
  const cancelledId = cancelledMatch.rows[0].id;
  fixtureIds.push(cancelledId);

  console.log("\n=== anon can read an open match, exact shape ===\n");
  const openResult = await asAnon(client, () =>
    client.query(`select * from public.get_open_match_public($1)`, [openId])
  );
  const openRow = (openResult as any).rows[0];
  assertEqual("row count for a real open match", (openResult as any).rowCount, 1);
  assertEqual("status is returned verbatim", openRow.status, "open");
  assertEqual("target_city matches", openRow.target_city, CITY);
  assertEqual("accepted_count reflects the real headcount (host + 1 accepted)", openRow.accepted_count, 2);
  assertEqual(
    "only the five documented columns come back, nothing extra",
    Object.keys(openRow).sort(),
    ["accepted_count", "host_avatar_url", "host_display_name", "status", "target_city"].sort()
  );

  console.log("\n=== anon can read a converted/cancelled match too — not a 404 ===\n");
  const convertedResult = await asAnon(client, () =>
    client.query(`select * from public.get_open_match_public($1)`, [convertedId])
  );
  assertEqual("a converted match still returns a row", (convertedResult as any).rowCount, 1);
  assertEqual(
    "its status is returned verbatim as 'converted', not translated here",
    (convertedResult as any).rows[0]?.status ?? null,
    "converted"
  );

  const cancelledResult = await asAnon(client, () =>
    client.query(`select * from public.get_open_match_public($1)`, [cancelledId])
  );
  assertEqual("a cancelled match still returns a row", (cancelledResult as any).rowCount, 1);
  assertEqual(
    "its status is returned verbatim as 'cancelled'",
    (cancelledResult as any).rows[0]?.status ?? null,
    "cancelled"
  );

  console.log("\n=== a nonexistent id is the only real 'not found' ===\n");
  const missingResult = await asAnon(client, () =>
    client.query(`select * from public.get_open_match_public($1)`, ["00000000-0000-0000-0000-000000000000"])
  );
  assertEqual("a random id that matches nothing returns zero rows", (missingResult as any).rowCount, 0);

  console.log("\n=== anon still cannot reach open_match_join_requests directly ===\n");
  // Either outcome proves the boundary: a permission error (no table
  // grant) or zero rows (grant exists, but the policy is `to
  // authenticated` only, so RLS filters everything for anon). What must
  // never happen is a real row coming back.
  try {
    const r = await asAnon(client, () =>
      client.query(`select * from public.open_match_join_requests where open_match_id = $1`, [openId])
    );
    assertEqual("anon reading open_match_join_requests directly gets zero rows (RLS, not this function)", (r as any).rowCount, 0);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`OK   anon is rejected outright reading open_match_join_requests directly: ${message}`);
  }

  console.log("\n=== teardown ===\n");
  await client.query(`delete from public.open_matches where id = any($1)`, [fixtureIds]);
  console.log("fixtures cleaned up.");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
