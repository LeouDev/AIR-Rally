/**
 * Read-only inspection of the Phase 7.1 COURT/Side tables against
 * whatever database DATABASE_URL points at — gated by
 * assert-staging-env.ts. Issues no writes at all; safe to run any
 * number of times.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-court-side.ts
 */
import "./assert-staging-env";
import { Client } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const TABLES = ["posts", "post_likes", "post_comments", "follows", "events", "event_attendees"];
const FUNCTIONS = ["update_post_like_count", "update_post_comment_count"];

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  console.log("Connected.\n");

  let allOk = true;

  for (const table of TABLES) {
    const existsResult = await client.query(
      `select relrowsecurity from pg_class where relname = $1 and relnamespace = 'public'::regnamespace`,
      [table]
    );
    if (existsResult.rows.length === 0) {
      console.log(`✗ Table "${table}" does not exist`);
      allOk = false;
      continue;
    }
    const rlsEnabled = existsResult.rows[0].relrowsecurity;
    console.log(`${rlsEnabled ? "✓" : "✗"} Table "${table}" exists, RLS ${rlsEnabled ? "enabled" : "DISABLED"}`);
    if (!rlsEnabled) allOk = false;

    const policiesResult = await client.query(`select polname, polcmd from pg_policy where polrelid = $1::regclass`, [
      `public.${table}`,
    ]);
    console.log(`  policies: ${policiesResult.rows.map((r) => `${r.polname} (${r.polcmd})`).join(", ")}`);
  }

  console.log();
  for (const fn of FUNCTIONS) {
    const result = await client.query(
      `select prosecdef from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
      [fn]
    );
    if (result.rows.length === 0) {
      console.log(`✗ Function "${fn}" does not exist`);
      allOk = false;
      continue;
    }
    console.log(`${result.rows[0].prosecdef ? "✓" : "✗"} Function "${fn}" exists, SECURITY DEFINER: ${result.rows[0].prosecdef}`);
    if (!result.rows[0].prosecdef) allOk = false;
  }

  console.log();
  const checkResult = await client.query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname = 'follows_no_self_follow'`
  );
  if (checkResult.rows.length === 0) {
    console.log("✗ follows_no_self_follow CHECK constraint does not exist");
    allOk = false;
  } else {
    console.log(`✓ follows_no_self_follow: ${checkResult.rows[0].def}`);
  }

  await client.end();
  console.log(allOk ? "\nAll checks passed." : "\nSome checks FAILED — see above.");
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
