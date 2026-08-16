/**
 * Applies every file in supabase/migrations/, in filename order, to
 * whatever database DATABASE_URL points at — gated by
 * assert-staging-env.ts, which throws before this file's own code runs
 * at all if the resolved Supabase project (or DATABASE_URL) matches this
 * project's known real/production ref.
 *
 * This project has never used the Supabase CLI's linked-project /
 * migration-history workflow (no supabase/config.toml exists, and this
 * repo's own README documents pasting each file into the Dashboard SQL
 * Editor by hand instead) — this script is a direct, minimal substitute
 * for that manual process, not a new migration-tracking system. It does
 * NOT record which migrations have run anywhere; each file's own SQL
 * (mostly bare `create table`/`create policy`/`create function`) is
 * expected to run exactly once against a truly fresh database. Running
 * it twice against the same database will fail loudly on the first
 * `create table`/`create policy` that already exists — that's
 * intentional (fail loudly, never silently skip or guess), not a bug.
 *
 * Stops immediately (rolls back the failing file's own transaction, does
 * not attempt any later file) on the first error — per this task's
 * explicit "stop before making a compensating change" instruction.
 *
 * Usage (after sourcing .env.staging into the shell):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/apply-staging-migrations.ts
 *   (same, with --only=20260810000015_booking_reschedules.sql appended, to apply just one file)
 *
 *   The TS_NODE_COMPILER_OPTIONS override is required in this environment
 *   (Node 22 + this project's tsconfig `"module": "esnext"` otherwise
 *   makes ts-node emit ESM that Node refuses to load from a `.ts` entry
 *   file with "Unknown file extension .ts") — this is a pre-existing
 *   environment quirk affecting every scripts/*.ts file in this repo,
 *   not something specific to this script.
 */
import "./assert-staging-env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg?.slice("--only=".length);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const toApply = only ? files.filter((f) => f === only) : files;

  if (toApply.length === 0) {
    console.error(only ? `No migration file matching "${only}" found in ${MIGRATIONS_DIR}` : `No .sql files found in ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const databaseUrl = requireEnv("DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  console.log(`Connected. Applying ${toApply.length} migration file(s) in order:\n${toApply.map((f) => `  - ${f}`).join("\n")}\n`);

  try {
    for (const file of toApply) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`\n--- Applying ${file} ---`);
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("commit");
        console.log(`OK: ${file}`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        console.error(`\nFAILED applying ${file}:`);
        console.error(error instanceof Error ? error.message : error);
        console.error("\nStopping here — no later migration file was attempted. Nothing was rolled forward past this point.");
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\nAll ${toApply.length} migration file(s) applied successfully.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
