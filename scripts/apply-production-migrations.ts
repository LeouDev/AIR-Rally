/**
 * Applies migration files to PRODUCTION, one transaction per file.
 *
 * The staging runner imports assert-staging-env.ts, which hard-refuses the
 * production ref — correctly, and that must not change. This is its
 * deliberate counterpart: it refuses ANY target that is not production, so
 * neither script can be pointed at the wrong database by sourcing the wrong
 * env file.
 *
 * Each file runs inside its own transaction. A failure rolls that file back
 * and STOPS the run — earlier files stay applied, and the failure is
 * reported rather than skipped. Migrations are ordered and interdependent,
 * so continuing past a failure would compound the problem.
 *
 * Usage:
 *   node -r ts-node/register scripts/apply-production-migrations.ts --from 20260810000021 --confirm
 */
import { Client } from "pg";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const PRODUCTION_REF = "hrpbjudsrqcgyrkkodop";
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.includes(PRODUCTION_REF)) {
    console.error(`Refusing: DATABASE_URL does not target ${PRODUCTION_REF}. This runner is production-only.`);
    process.exit(1);
  }
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing: pass --confirm.");
    process.exit(1);
  }

  const from = arg("from");
  if (!from) {
    console.error("Refusing: pass --from <migration-prefix>, e.g. --from 20260810000021");
    process.exit(1);
  }

  // --to is inclusive. Needed because production turned out to be applied
  // out of order: 021-023 landed before the run stopped, so the remaining
  // gap has to be filled in two bounded passes rather than one open range.
  const to = arg("to");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => {
      const prefix = f.split("_")[0];
      return prefix >= from && (!to || prefix <= to);
    });

  console.log(`Connected target: production (${PRODUCTION_REF})`);
  console.log(`Applying ${files.length} migration(s), starting at ${from}.\n`);

  const client = new Client({ connectionString });
  await client.connect();

  let applied = 0;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`  ${file.padEnd(60)}`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      applied += 1;
      console.log("OK");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.log("FAILED");
      console.error(`\n  ${file} rolled back. Nothing from this file was applied.`);
      console.error(`  ${(error as Error).message}`);
      console.error(`\n  ${applied} migration(s) applied before this one. STOPPING.`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nAll ${applied} migration(s) applied.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
