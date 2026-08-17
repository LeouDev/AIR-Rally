/**
 * READ-ONLY logical backup of the production database's public schema.
 *
 * Supabase's free tier has no on-demand backups, so this stands in as the
 * recovery point required by Phase 5 of the migration brief. It is a DATA
 * backup: every row of every public table, written as JSON, plus INSERT
 * statements that can restore them.
 *
 * SAFETY: every statement is a SELECT, inside a READ ONLY transaction. The
 * target must be production or it refuses.
 *
 * WHAT IT DOES NOT COVER, and why that is acceptable here:
 *   * auth.users — deliberately untouched. Password hashes are never read
 *     or written by this project (brief Rule 7). The planned deletion does
 *     not touch auth at all, so nothing to restore.
 *   * schema DDL — reproducible from supabase/migrations/*.sql, which is
 *     the authority for structure.
 *   * storage objects — production's only bucket is empty (0 objects).
 *
 * Output goes to .backups/ which is gitignored: it contains production
 * data and must never be committed.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/backup-production-readonly.ts
 */
import { Client } from "pg";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const PRODUCTION_REF = "hrpbjudsrqcgyrkkodop";
const OUT_DIR = path.join(process.cwd(), ".backups");

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }
  if (!connectionString.includes(PRODUCTION_REF)) {
    console.error(`Refusing: DATABASE_URL does not target ${PRODUCTION_REF}.`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  await client.query("begin transaction read only");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const tables = (await client.query(`select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map(
    (r: { tablename: string }) => r.tablename
  );

  const dump: Record<string, unknown[]> = {};
  const sqlParts: string[] = [
    `-- AIR/Rally production data backup`,
    `-- project: ${PRODUCTION_REF}`,
    `-- taken:   ${new Date().toISOString()}`,
    `-- restore: run inside a transaction, in the order below (parents first).`,
    ``,
  ];

  let total = 0;
  for (const table of tables) {
    const rows = (await client.query(`select * from public."${table}"`)).rows;
    dump[table] = rows;
    total += rows.length;
    console.log(`  ${table.padEnd(30)} ${rows.length}`);

    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    sqlParts.push(`-- ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const values = columns.map((c) => sqlLiteral((row as Record<string, unknown>)[c])).join(", ");
      sqlParts.push(`insert into public."${table}" (${columns.map((c) => `"${c}"`).join(", ")}) values (${values});`);
    }
    sqlParts.push("");
  }

  const jsonPath = path.join(OUT_DIR, `production-${stamp}.json`);
  const sqlPath = path.join(OUT_DIR, `production-${stamp}.sql`);
  writeFileSync(jsonPath, JSON.stringify({ project: PRODUCTION_REF, takenAt: new Date().toISOString(), tables: dump }, null, 2));
  writeFileSync(sqlPath, sqlParts.join("\n"));

  await client.query("rollback");
  await client.end();

  console.log(`\nTotal rows backed up: ${total}`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${sqlPath}`);
  console.log("\nRead-only transaction rolled back. Production was not modified.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
