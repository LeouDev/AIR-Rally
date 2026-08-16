/**
 * Live proof of the production-readiness audit's finding B1: an
 * ordinary authenticated staging user cannot call complete_reschedule()/
 * mark_reschedule_failed()/record_reschedule_refund_success() directly,
 * and cannot forge a booking_reschedules row into a non-starting state —
 * while the service-role path this app's own code actually uses remains
 * reachable. Gated by assert-staging-env.ts.
 *
 * This intentionally does NOT require any pre-existing booking/reschedule
 * data: PostgREST/Postgres reject an unauthorized RPC call on GRANT
 * privileges alone, before the function body (and thus any row lookup)
 * ever runs — so a made-up UUID is sufficient to prove the rejection is
 * a genuine permission failure, not a "not found" business-logic no-op.
 * The service-role call is proven reachable the same way: it must return
 * a clean `false` (not-found, since the id is fake), never a permission
 * error — a permission error there would mean the grant itself is wrong.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-security.ts
 *   (see apply-staging-migrations.ts's header for why this exact invocation is needed)
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    process.exit(1);
  }
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  // --- Authenticated (ordinary customer) client ---
  const authClient = createClient(url, anonKey);
  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");
  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) {
    console.error(`Could not sign in as ${email}: ${signInError?.message}`);
    process.exit(1);
  }
  console.log(`Signed in as ${email} (uid=${signInData.user.id})\n`);

  // 1. Direct complete_reschedule() must be rejected.
  const completeAttempt = await authClient.rpc("complete_reschedule", { p_reschedule_id: FAKE_UUID, p_refund_id: null });
  record(
    "authenticated client CANNOT call complete_reschedule()",
    completeAttempt.error !== null,
    completeAttempt.error ? `rejected: ${completeAttempt.error.code} ${completeAttempt.error.message}` : `NOT REJECTED — returned data=${JSON.stringify(completeAttempt.data)}`
  );

  // 2. Direct mark_reschedule_failed() must be rejected.
  const failAttempt = await authClient.rpc("mark_reschedule_failed", {
    p_reschedule_id: FAKE_UUID,
    p_status: "failed",
    p_failure_reason: "attack test",
    p_refund_id: null,
  });
  record(
    "authenticated client CANNOT call mark_reschedule_failed()",
    failAttempt.error !== null,
    failAttempt.error ? `rejected: ${failAttempt.error.code} ${failAttempt.error.message}` : `NOT REJECTED — returned data=${JSON.stringify(failAttempt.data)}`
  );

  // 3. Direct record_reschedule_refund_success() must be rejected.
  const checkpointAttempt = await authClient.rpc("record_reschedule_refund_success", { p_reschedule_id: FAKE_UUID, p_refund_id: FAKE_UUID });
  record(
    "authenticated client CANNOT call record_reschedule_refund_success()",
    checkpointAttempt.error !== null,
    checkpointAttempt.error ? `rejected: ${checkpointAttempt.error.code} ${checkpointAttempt.error.message}` : `NOT REJECTED — returned data=${JSON.stringify(checkpointAttempt.data)}`
  );

  // 4. Forged INSERT: a client cannot create a row that's already
  //    "completed" or carries a refund_id at insert time.
  const forgedInsert = await authClient
    .from("booking_reschedules")
    .insert({
      original_booking_id: FAKE_UUID,
      new_booking_id: FAKE_UUID,
      price_difference: 0,
      status: "completed",
      refund_id: FAKE_UUID,
      initiated_by: signInData.user.id,
    })
    .select("*")
    .maybeSingle();
  record(
    "authenticated client CANNOT insert a booking_reschedules row with status='completed'/refund_id set",
    forgedInsert.error !== null,
    forgedInsert.error ? `rejected: ${forgedInsert.error.code} ${forgedInsert.error.message}` : `NOT REJECTED — inserted row ${JSON.stringify(forgedInsert.data)}`
  );

  // 5. Forged INSERT against a non-owned original_booking_id (even with
  //    a legitimately-shaped row) — RLS's `exists(... b.user_id =
  //    auth.uid())` clause must reject this regardless of whose id it is,
  //    since FAKE_UUID certainly isn't a booking this user owns.
  const crossUserInsert = await authClient
    .from("booking_reschedules")
    .insert({
      original_booking_id: FAKE_UUID,
      new_booking_id: FAKE_UUID,
      price_difference: 0,
      status: "pending_payment",
      initiated_by: signInData.user.id,
    })
    .select("*")
    .maybeSingle();
  record(
    "authenticated client CANNOT insert a reschedule referencing a booking they don't own",
    crossUserInsert.error !== null,
    crossUserInsert.error ? `rejected: ${crossUserInsert.error.code} ${crossUserInsert.error.message}` : `NOT REJECTED — inserted row ${JSON.stringify(crossUserInsert.data)}`
  );

  // --- Service-role client (the app's own legitimate path) ---
  const serviceClient = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const serviceComplete = await serviceClient.rpc("complete_reschedule", { p_reschedule_id: FAKE_UUID, p_refund_id: null });
  record(
    "service_role CAN reach complete_reschedule() (clean 'not found' false, never a permission error)",
    serviceComplete.error === null && serviceComplete.data === false,
    serviceComplete.error ? `UNEXPECTED PERMISSION/OTHER ERROR: ${serviceComplete.error.code} ${serviceComplete.error.message}` : `data=${serviceComplete.data}`
  );

  const serviceFail = await serviceClient.rpc("mark_reschedule_failed", { p_reschedule_id: FAKE_UUID, p_status: "failed", p_failure_reason: "test", p_refund_id: null });
  record(
    "service_role CAN reach mark_reschedule_failed() (clean 'not found' false)",
    serviceFail.error === null && serviceFail.data === false,
    serviceFail.error ? `UNEXPECTED ERROR: ${serviceFail.error.code} ${serviceFail.error.message}` : `data=${serviceFail.data}`
  );

  const serviceCheckpoint = await serviceClient.rpc("record_reschedule_refund_success", { p_reschedule_id: FAKE_UUID, p_refund_id: FAKE_UUID });
  record(
    "service_role CAN reach record_reschedule_refund_success() (clean 'not found' false)",
    serviceCheckpoint.error === null && serviceCheckpoint.data === false,
    serviceCheckpoint.error ? `UNEXPECTED ERROR: ${serviceCheckpoint.error.code} ${serviceCheckpoint.error.message}` : `data=${serviceCheckpoint.data}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFAILURES:");
    failed.forEach((f) => console.log(`  - ${f.check}: ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
