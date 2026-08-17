/**
 * READ-ONLY security verification for PRODUCTION. Phase 12 of the migration
 * brief: RLS isolation and SECURITY DEFINER authorization.
 *
 * WHY THIS IS STRUCTURAL, NOT BEHAVIOURAL
 *
 * The staging equivalents prove isolation by creating throwaway users,
 * venues and bookings, exercising the policies, then deleting everything.
 * That is the right approach for staging and the wrong one for production:
 * it writes test rows into a live database, and the cleanup is not
 * guaranteed — the audit for this very migration found orphaned venues,
 * a booking and a settlement left behind in staging when a `finally` block
 * swallowed a foreign-key error.
 *
 * So this verifies the SHAPE of the protections instead:
 *   * RLS is enabled on every public table
 *   * no table is RLS-enabled yet policy-less (locked out), and none is
 *     RLS-disabled (wide open)
 *   * every SECURITY DEFINER function either carries an authorization
 *     check in its own body, or is not executable by anon/authenticated
 *
 * That last one is the real question Phase 12 asks. A SECURITY DEFINER
 * function bypasses RLS by design, so its own guard IS the boundary — this
 * is exactly how reconcile_settlements() was found leaking platform-wide
 * settlement data to any signed-in user.
 *
 * SAFETY: every statement is a SELECT inside a READ ONLY transaction, and
 * the target must be production or it refuses.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-production-security.ts
 */
import { Client } from "pg";

const PRODUCTION_REF = "hrpbjudsrqcgyrkkodop";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`✓ ${label}`);
    passed += 1;
  } else {
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

/**
 * Functions whose authorization lives INSIDE the function body. Each must
 * mention its guard in its own source, because being SECURITY DEFINER means
 * RLS will not stop the caller.
 */
const BODY_GUARDED: Record<string, string> = {
  reconcile_settlements: "is_admin",
  payout_cash_position: "is_admin",
  available_settlements_for_payout: "is_admin",
  venue_payout_readiness: "is_admin",
  create_payout_batch: "is_admin",
  approve_payout_batch: "is_admin",
  cancel_payout_batch: "is_admin",
  set_venue_payment_account_status: "is_admin",
  invite_event_players: "auth.uid",
};

/**
 * Functions that must NOT be callable by a browser session at all. Their
 * protection is the grant, not the body — they are reachable only from
 * server code holding the service-role key.
 */
const SERVICE_ROLE_ONLY = [
  "issue_credit",
  "spend_credit",
  "apply_credit_to_booking",
  "confirm_credit_only_booking",
  "mark_settlements_payable",
  // Both added after this script's first run found them anon-callable.
  // Each writes payment-authoritative state and cannot verify payment
  // itself, so the caller must be trusted server code:
  //   confirm_paymongo_booking_payment — free bookings (migration 047)
  //   confirm_booking_payment          — its dead Stripe twin (047)
  //   sync_venue_paymongo_activation   — venue self-activation (048)
  "confirm_paymongo_booking_payment",
  "confirm_booking_payment",
  "sync_venue_paymongo_activation",
];

/**
 * SECURITY DEFINER functions that are intentionally callable by anon.
 * Anonymous visitors browse courts before signing in, so availability has
 * to resolve without a session. Both are read-only.
 */
const PUBLIC_READ_ONLY = ["get_available_slots", "is_court_time_bookable"];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.includes(PRODUCTION_REF)) {
    console.error(`Refusing: DATABASE_URL does not target ${PRODUCTION_REF}. This verification is production-only.`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  await client.query("begin transaction read only");
  console.log(`Verifying production (${PRODUCTION_REF}) — READ ONLY.\n`);

  const rows = async (sql: string) => (await client.query(sql)).rows;

  // --- RLS coverage -------------------------------------------------------
  console.log("— Row Level Security —");
  const tables = (await rows(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
            (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)::int policies
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' order by c.relname`
  )) as { relname: string; relrowsecurity: boolean; policies: number }[];

  const rlsOff = tables.filter((t) => !t.relrowsecurity);
  check("RLS is enabled on every public table", rlsOff.length === 0, rlsOff.map((t) => t.relname).join(", "));

  const noPolicies = tables.filter((t) => t.relrowsecurity && t.policies === 0);
  // A table with RLS on and no policies denies everyone. That is safe, but
  // it is almost always a mistake rather than a decision.
  check(
    "no table is RLS-enabled with zero policies",
    noPolicies.length === 0,
    noPolicies.map((t) => t.relname).join(", ")
  );

  console.log(`  (${tables.length} tables, ${tables.reduce((n, t) => n + t.policies, 0)} policies)`);

  // --- Write protection on ledger tables ----------------------------------
  console.log("\n— Ledger tables are read-only to clients —");
  for (const table of ["credit_transactions", "user_credit_wallets", "booking_settlements", "payout_transfers"]) {
    const writes = (await rows(
      `select count(*)::int n from pg_policies
       where schemaname='public' and tablename='${table}' and cmd in ('INSERT','UPDATE','DELETE')`
    )) as { n: number }[];
    check(`${table} has no INSERT/UPDATE/DELETE policy for any role`, writes[0].n === 0, `${writes[0].n} write policy(ies)`);
  }

  // --- SECURITY DEFINER inventory ----------------------------------------
  console.log("\n— SECURITY DEFINER authorization —");
  const definers = (await rows(
    `select p.proname, p.prosrc,
            pg_get_function_result(p.oid) = 'trigger' as is_trigger,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_can_execute,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon_can_execute
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef order by p.proname`
  )) as { proname: string; prosrc: string; is_trigger: boolean; auth_can_execute: boolean; anon_can_execute: boolean }[];

  console.log(`  (${definers.length} SECURITY DEFINER functions)`);

  for (const [name, guard] of Object.entries(BODY_GUARDED)) {
    const fn = definers.find((d) => d.proname === name);
    if (!fn) {
      check(`${name} exists`, false, "not found");
      continue;
    }
    check(`${name}() carries its own ${guard}() check`, fn.prosrc.includes(guard));
  }

  for (const name of SERVICE_ROLE_ONLY) {
    const fn = definers.find((d) => d.proname === name);
    if (!fn) {
      check(`${name} exists`, false, "not found");
      continue;
    }
    check(`${name}() is not executable by a browser session`, !fn.auth_can_execute && !fn.anon_can_execute);
  }

  // Anything SECURITY DEFINER, callable by anon, and lacking any visible
  // guard is worth a human look — that is the exact shape of the
  // reconcile_settlements leak, and of the two holes fixed in migrations
  // 047 and 048.
  //
  // Two exclusions, both about what is actually *reachable*:
  //
  //  * Trigger functions. They take no arguments and return `trigger`, so
  //    PostgREST will not expose them as RPCs at all — Postgres reports
  //    EXECUTE for anon on all of them, which made the first run of this
  //    script flag 35 of them and bury the two real findings.
  //  * PUBLIC_READ_ONLY below: deliberately anon-callable availability
  //    lookups. Anonymous visitors browse courts before signing in, so
  //    these have to work without a session. Both only SELECT.
  console.log("\n— Unguarded definer functions reachable by anon —");
  const suspicious = definers.filter(
    (d) =>
      d.anon_can_execute &&
      !d.is_trigger &&
      !PUBLIC_READ_ONLY.includes(d.proname) &&
      !d.prosrc.includes("is_admin") &&
      !d.prosrc.includes("auth.uid")
  );
  check(
    "no anon-callable definer function lacks an authorization check",
    suspicious.length === 0,
    suspicious.map((d) => d.proname).join(", ")
  );

  // --- Booking tamper guard ----------------------------------------------
  console.log("\n— Booking integrity —");
  const tamper = definers.find((d) => d.proname === "prevent_booking_tampering");
  check("prevent_booking_tampering() exists", Boolean(tamper));
  if (tamper) {
    // The column whose absence allowed unlimited credit minting.
    check("it guards credit_amount_applied", tamper.prosrc.includes("credit_amount_applied"));
    check("it guards price_amount", tamper.prosrc.includes("price_amount"));
    check("it honours the bypass flag for privileged writers", tamper.prosrc.includes("bypass_booking_tampering"));
  }

  const confirm = definers.find((d) => d.proname === "confirm_paymongo_booking_payment");
  check("confirm_paymongo_booking_payment() exists", Boolean(confirm));
  if (confirm) {
    // Must expect price minus credit, or every partially-credited booking
    // takes payment and never confirms.
    check(
      "it expects price_amount - credit_amount_applied",
      confirm.prosrc.includes("credit_amount_applied") && confirm.prosrc.includes("price_amount")
    );
    check("it only transitions pending bookings (idempotent)", confirm.prosrc.includes("'pending'"));
  }

  // --- Payout execution stays impossible ---------------------------------
  console.log("\n— Payout execution is blocked —");
  const transferStatus = definers.find((d) => d.proname === "enforce_payout_transfer_status");
  check("enforce_payout_transfer_status() exists", Boolean(transferStatus));
  if (transferStatus) {
    check(
      "a transfer cannot reach 'completed' without the DB-level flag",
      transferStatus.prosrc.includes("allow_transfer_completion")
    );
  }
  const batchStatus = definers.find((d) => d.proname === "enforce_payout_batch_status");
  if (batchStatus) {
    check("a batch cannot reach 'processing'/'completed'", batchStatus.prosrc.includes("not implemented") || batchStatus.prosrc.includes("feature_not_supported"));
  }

  const settled = (await rows(`select count(*)::int n from public.booking_settlements where settlement_status='settled'`)) as { n: number }[];
  check("no settlement anywhere is marked 'settled'", settled[0].n === 0, `${settled[0].n} found`);

  await client.query("rollback");
  await client.end();

  console.log(`\n${failed === 0 ? "All checks passed." : "Some checks FAILED."} (${passed} passed, ${failed} failed)`);
  console.log("Read-only transaction rolled back. Production was not modified.");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
