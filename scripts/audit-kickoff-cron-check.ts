/**
 * Checks the results of audit-kickoff-cron-setup.ts's fixtures AFTER
 * the real pg_cron job has had a chance to fire on its own — proves the
 * cron itself converts/expires real data unattended, not just that the
 * function does the right thing when called directly.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/audit-kickoff-cron-check.ts
 * (after sourcing .env.staging).
 */
import "./assert-staging-env";
import { Client } from "pg";

const IDS = {
  matchA: "9426bbb1-5ac0-48fc-b15b-51e90b1a639b",
  matchB: "6b58eb2f-9abf-4693-b1e4-607e7fbbdc9b",
  matchC: "6cb45b67-623f-40de-9507-ca87ce6053ae",
  matchD: "47407e47-0f03-40f6-8a90-19ec4a4a73af",
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const runs = await client.query(
    `select start_time, status, return_message from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname = 'resolve-open-matches-at-kickoff')
       and start_time > now() - interval '10 minutes'
     order by start_time desc`
  );
  console.log("Real cron ticks in the last 10 minutes:");
  console.log(JSON.stringify(runs.rows, null, 2));

  const r = await client.query(
    `select id, status, converted_match_id from public.open_matches where id = any($1)`,
    [Object.values(IDS)]
  );
  const byId = Object.fromEntries(r.rows.map((row) => [row.id, row]));

  console.log("\nA (1 accepted, expect expired):", byId[IDS.matchA]);
  console.log("B (2 accepted, expect converted/singles):", byId[IDS.matchB]);
  console.log("C (3 accepted, expect expired):", byId[IDS.matchC]);
  console.log("D (4 accepted, expect converted/doubles):", byId[IDS.matchD]);

  if (byId[IDS.matchB]?.converted_match_id) {
    const mt = await client.query(`select match_type, status, created_at from public.ranked_matches where id = $1`, [byId[IDS.matchB].converted_match_id]);
    console.log("\nB's real ranked match:", mt.rows[0]);
  }
  if (byId[IDS.matchD]?.converted_match_id) {
    const mt = await client.query(`select match_type, status, created_at from public.ranked_matches where id = $1`, [byId[IDS.matchD].converted_match_id]);
    console.log("D's real ranked match:", mt.rows[0]);
    const players = await client.query(`select count(*)::int as n from public.ranked_match_players where match_id = $1`, [byId[IDS.matchD].converted_match_id]);
    console.log("D's player count:", players.rows[0].n);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
