/**
 * READ-ONLY audit of the production database. Phase 1 of the staging →
 * production migration brief.
 *
 * This file deliberately does NOT import assert-staging-env.ts. Every other
 * script in this repo does, and must keep doing so — they write. This one
 * only reads, and reading production is the entire point of Phase 1.
 *
 * SAFETY: every statement below is a SELECT. There is no INSERT, UPDATE,
 * DELETE, ALTER, CREATE, DROP or TRUNCATE anywhere in this file, and the
 * connection is opened inside a READ ONLY transaction so the database
 * itself would reject a write even if one were added by mistake.
 *
 * Usage (after sourcing an env that points at production):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/audit-production-readonly.ts
 */
import { Client } from "pg";

const PRODUCTION_REF = "hrpbjudsrqcgyrkkodop";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

async function rows(client: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await client.query(sql)).rows;
}

async function main(): Promise<void> {
  const connectionString = requireEnv("DATABASE_URL");

  // Refuse to run against anything that isn't production — the mirror image
  // of assert-staging-env, so this file can never be pointed at staging and
  // silently produce a report labelled "production".
  if (!connectionString.includes(PRODUCTION_REF)) {
    console.error(`Refusing: DATABASE_URL does not target ${PRODUCTION_REF}. This audit is production-only.`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  // The database enforces read-only for this session. Belt and braces.
  await client.query("begin transaction read only");

  console.log(`Connected to production (${PRODUCTION_REF}) — READ ONLY.\n`);

  console.log("=== SCHEMA OBJECT COUNTS ===");
  const counts = await rows(
    client,
    `select 'tables' k, count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
     union all select 'views', count(*)::int from information_schema.views where table_schema='public'
     union all select 'functions', count(*)::int from information_schema.routines where routine_schema='public'
     union all select 'triggers', count(distinct trigger_name)::int from information_schema.triggers where trigger_schema='public'
     union all select 'rls_policies', count(*)::int from pg_policies where schemaname='public'
     union all select 'indexes', count(*)::int from pg_indexes where schemaname='public'
     union all select 'storage_buckets', count(*)::int from storage.buckets
     union all select 'auth_users', count(*)::int from auth.users`
  );
  counts.forEach((r) => console.log(`  ${String(r.k).padEnd(18)} ${r.n}`));

  console.log("\n=== TABLES PRESENT ===");
  const tables = (await rows(client, `select tablename from pg_tables where schemaname='public' order by tablename`)).map(
    (r) => String(r.tablename)
  );
  console.log(`  ${tables.join(", ")}`);

  // The 13 tables introduced by migrations 029-046. Their absence is the
  // schema gap this whole exercise exists to close.
  const EXPECTED_NEW = [
    "clubs",
    "club_members",
    "events",
    "event_attendees",
    "post_reshares",
    "post_mentions",
    "user_credit_wallets",
    "credit_transactions",
    "booking_settlements",
    "payout_batches",
    "payout_batch_items",
    "payout_transfers",
    "venue_payment_accounts",
  ];
  console.log("\n=== MIGRATION-GAP TABLES (029-046) ===");
  for (const t of EXPECTED_NEW) {
    console.log(`  ${t.padEnd(24)} ${tables.includes(t) ? "PRESENT" : "MISSING"}`);
  }

  console.log("\n=== ROW COUNTS (production) ===");
  for (const t of tables) {
    const r = await rows(client, `select count(*)::int n from public."${t}"`);
    console.log(`  ${t.padEnd(30)} ${r[0].n}`);
  }

  console.log("\n=== AUTH USERS ===");
  const users = await rows(
    client,
    `select split_part(u.email,'@',2) domain, count(*)::int n from auth.users u group by 1 order by 2 desc`
  );
  if (users.length === 0) console.log("  (none)");
  users.forEach((r) => console.log(`  @${String(r.domain).padEnd(24)} ${r.n}`));

  console.log("\n=== STORAGE BUCKETS ===");
  const buckets = await rows(
    client,
    `select b.id, b.public, (select count(*) from storage.objects o where o.bucket_id=b.id)::int objs from storage.buckets b order by b.id`
  );
  if (buckets.length === 0) console.log("  (none)");
  buckets.forEach((r) => console.log(`  ${String(r.id).padEnd(16)} public=${r.public} objects=${r.objs}`));

  console.log("\n=== KEY FUNCTIONS PRESENT? ===");
  const FUNCS = [
    "is_admin",
    "prevent_booking_tampering",
    "confirm_paymongo_booking_payment",
    "apply_credit_to_booking",
    "reconcile_settlements",
    "create_payout_batch",
    "invite_event_players",
  ];
  for (const f of FUNCS) {
    const r = await rows(client, `select count(*)::int n from information_schema.routines where routine_schema='public' and routine_name='${f}'`);
    console.log(`  ${f.padEnd(36)} ${Number(r[0].n) > 0 ? "present" : "MISSING"}`);
  }

  await client.query("rollback");
  await client.end();
  console.log("\nRead-only transaction rolled back. Nothing was modified.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
