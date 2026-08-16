/**
 * Read-only inspection of booking_reschedules and its supporting
 * functions/triggers against whatever database DATABASE_URL points at —
 * gated by assert-staging-env.ts. Issues no writes at all; safe to run
 * any number of times.
 *
 * Answers, directly from pg_catalog/information_schema (never inferred
 * from the migration file's SQL text):
 *   - does booking_reschedules exist, with the right columns/CHECK/FKs
 *   - does the partial unique index exist with the right definition
 *   - is RLS enabled, and do the expected policies exist
 *   - do complete_reschedule/mark_reschedule_failed/
 *     record_reschedule_refund_success exist, are they SECURITY DEFINER,
 *     and — the actual point of finding B1 — do anon/authenticated
 *     genuinely lack EXECUTE while service_role has it
 *   - does the bookings-cancellation reconciliation trigger exist
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-schema.ts
 *   (see apply-staging-migrations.ts's header for why this exact invocation is needed)
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

const FUNCTIONS = [
  { name: "complete_reschedule", signature: "complete_reschedule(uuid,uuid)" },
  { name: "mark_reschedule_failed", signature: "mark_reschedule_failed(uuid,text,text,uuid)" },
  { name: "record_reschedule_refund_success", signature: "record_reschedule_refund_success(uuid,uuid)" },
];

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    // 1. Table exists
    const table = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name='booking_reschedules'`
    );
    record("table exists", table.rowCount === 1, table.rowCount === 1 ? "public.booking_reschedules found" : "NOT FOUND — migration not applied?");
    if (table.rowCount !== 1) {
      console.log("\nStopping further checks — table doesn't exist.");
      return;
    }

    // 2. Columns
    const columns = await client.query(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
       where table_schema='public' and table_name='booking_reschedules' order by ordinal_position`
    );
    const expectedColumns = ["id", "original_booking_id", "new_booking_id", "price_difference", "status", "refund_id", "initiated_by", "reason", "failure_reason", "created_at", "updated_at"];
    const actualColumns = columns.rows.map((r) => r.column_name);
    const missingColumns = expectedColumns.filter((c) => !actualColumns.includes(c));
    record("expected columns present", missingColumns.length === 0, missingColumns.length === 0 ? actualColumns.join(", ") : `MISSING: ${missingColumns.join(", ")}`);

    // 3. CHECK constraints (status enum, in particular)
    const checks = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.booking_reschedules'::regclass and contype='c'`
    );
    const statusCheck = checks.rows.find((r) => String(r.def).includes("status"));
    record(
      "status CHECK constraint covers all 5 values",
      !!statusCheck && ["pending_payment", "pending_refund", "completed", "failed", "provider_unavailable"].every((s) => String(statusCheck.def).includes(s)),
      statusCheck ? statusCheck.def : "no status CHECK constraint found"
    );

    // 4. Foreign keys
    const fks = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.booking_reschedules'::regclass and contype='f'`
    );
    record("foreign keys present (original_booking_id, new_booking_id, refund_id, initiated_by)", fks.rowCount === 4, fks.rows.map((r) => r.def).join(" | "));

    // 5. Partial unique index
    const indexes = await client.query(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='booking_reschedules'`);
    const partialUnique = indexes.rows.find((r) => r.indexname === "booking_reschedules_one_pending_per_original");
    record(
      "booking_reschedules_one_pending_per_original exists and is a partial unique index covering pending_payment/pending_refund",
      !!partialUnique && /unique/i.test(partialUnique.indexdef) && /pending_payment/.test(partialUnique.indexdef) && /pending_refund/.test(partialUnique.indexdef),
      partialUnique ? partialUnique.indexdef : "NOT FOUND"
    );

    // 6. RLS enabled
    const rls = await client.query(`select relrowsecurity from pg_class where oid = 'public.booking_reschedules'::regclass`);
    record("RLS enabled", rls.rows[0]?.relrowsecurity === true, `relrowsecurity=${rls.rows[0]?.relrowsecurity}`);

    // 7. Policies
    const policies = await client.query(`select policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='booking_reschedules'`);
    const selectPolicy = policies.rows.find((r) => r.cmd === "SELECT");
    const insertPolicy = policies.rows.find((r) => r.cmd === "INSERT");
    const updatePolicy = policies.rows.find((r) => r.cmd === "UPDATE");
    const deletePolicy = policies.rows.find((r) => r.cmd === "DELETE");
    record("SELECT policy exists", !!selectPolicy, selectPolicy ? selectPolicy.policyname : "NOT FOUND");
    record(
      "INSERT policy exists and pins status='pending_payment' + refund_id IS NULL",
      !!insertPolicy && /pending_payment/.test(String(insertPolicy.with_check)) && /refund_id/.test(String(insertPolicy.with_check)) && /is null/i.test(String(insertPolicy.with_check)),
      insertPolicy ? String(insertPolicy.with_check) : "NOT FOUND"
    );
    record("NO client UPDATE policy exists (all transitions must go through the RPCs)", !updatePolicy, updatePolicy ? `UNEXPECTED: ${updatePolicy.policyname}` : "confirmed absent");
    record("NO client DELETE policy exists", !deletePolicy, deletePolicy ? `UNEXPECTED: ${deletePolicy.policyname}` : "confirmed absent");

    // 8. Functions: existence, SECURITY DEFINER, and — the actual point — grants
    for (const fn of FUNCTIONS) {
      const fnRow = await client.query(
        `select p.prosecdef, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=$1`,
        [fn.name]
      );
      record(`${fn.name} exists`, fnRow.rowCount === 1, fnRow.rowCount === 1 ? "found" : "NOT FOUND");
      if (fnRow.rowCount !== 1) continue;
      record(`${fn.name} is SECURITY DEFINER`, fnRow.rows[0].prosecdef === true, `prosecdef=${fnRow.rows[0].prosecdef}`);

      const grants = await client.query(
        `select
           has_function_privilege('anon', $1, 'EXECUTE') as anon_can_execute,
           has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated_can_execute,
           has_function_privilege('service_role', $1, 'EXECUTE') as service_role_can_execute`,
        [`public.${fn.signature}`]
      );
      const g = grants.rows[0];
      record(
        `${fn.name}: anon/authenticated CANNOT execute, service_role CAN (finding B1)`,
        g.anon_can_execute === false && g.authenticated_can_execute === false && g.service_role_can_execute === true,
        `anon=${g.anon_can_execute} authenticated=${g.authenticated_can_execute} service_role=${g.service_role_can_execute}`
      );
    }

    // 9. Trigger on bookings
    const trigger = await client.query(
      `select tgname, tgenabled, tgfoid::regproc as fn from pg_trigger
       where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgname = 'bookings_reconcile_reschedule_on_cancel'`
    );
    record(
      "bookings_reconcile_reschedule_on_cancel trigger exists on public.bookings, enabled",
      trigger.rowCount === 1 && trigger.rows[0].tgenabled !== "D",
      trigger.rowCount === 1 ? `fn=${trigger.rows[0].fn} tgenabled=${trigger.rows[0].tgenabled}` : "NOT FOUND"
    );

    // 10. Reschedule-table's own tampering trigger
    const ownTrigger = await client.query(
      `select tgname from pg_trigger where tgrelid = 'public.booking_reschedules'::regclass and not tgisinternal`
    );
    record(
      "booking_reschedules has its own set_updated_at + prevent_tampering triggers",
      ownTrigger.rows.some((r) => /prevent_tampering/.test(r.tgname)) && ownTrigger.rows.some((r) => /updated_at/.test(r.tgname)),
      ownTrigger.rows.map((r) => r.tgname).join(", ")
    );

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) {
      console.log("\nFAILURES:");
      failed.forEach((f) => console.log(`  - ${f.check}: ${f.detail}`));
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
