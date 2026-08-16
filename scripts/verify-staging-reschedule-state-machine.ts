/**
 * Live, real-Postgres verification of the reschedule state machine
 * itself (production-readiness audit's Phase 3 items 5-10) — orphan
 * reconciliation, complete_reschedule()'s self-trigger-interference
 * guard, the partial unique index, the pending_refund checkpoint, retry,
 * and idempotent completion. Operates directly at the SQL/RPC level
 * (service-role client + direct Postgres), bypassing the JS
 * orchestration layer on purpose — that layer is already covered by the
 * 427 Jest tests; this script's job is to prove the DATABASE half of
 * the contract those tests assume.
 *
 * Creates a small, clearly-marked ("[STAGING-TEST]") venue/court owned
 * by the signed-in test customer, and several bookings/reschedules
 * scoped to distinct future time windows so none of them can collide
 * via bookings_no_overlap. Cleans up everything it created at the end
 * (best-effort, in FK-safe order).
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-reschedule-state-machine.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function daysFromNow(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    process.exit(1);
  }
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");

  const authClient = createClient(url, anonKey);
  const serviceClient = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  const createdBookingIds: string[] = [];
  const createdRescheduleIds: string[] = [];
  const createdRefundIds: string[] = [];
  let courtId: string | null = null;
  let venueId: string | null = null;

  try {
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
    if (signInError || !signInData.user) throw new Error(`Could not sign in as ${email}: ${signInError?.message}`);
    const userId = signInData.user.id;
    console.log(`Signed in as ${email} (uid=${userId})\n`);

    // --- Setup: a small, clearly-marked venue/court -----------------
    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Reschedule Verification Venue", status: "active", indoor_outdoor: "outdoor" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    venueId = venueInsert.data.id;

    const courtInsert = await serviceClient
      .from("courts")
      .insert({ venue_id: venueId, name: "[STAGING-TEST] Court", hourly_price: 500, status: "active" })
      .select("*")
      .single();
    if (courtInsert.error) throw courtInsert.error;
    courtId = courtInsert.data.id;
    console.log(`Created test venue ${venueId} / court ${courtId}\n`);

    async function insertBooking(opts: { dayOffset: number; hour: number; durationHours: number; priceAmount: number; status: "confirmed" | "pending" }) {
      const start = daysFromNow(opts.dayOffset, opts.hour);
      const end = daysFromNow(opts.dayOffset, opts.hour + opts.durationHours);
      const { data, error } = await serviceClient
        .from("bookings")
        .insert({
          court_id: courtId,
          user_id: userId,
          start_time: start,
          end_time: end,
          status: opts.status,
          price_amount: opts.priceAmount,
          currency: "PHP",
          payment_provider: "stripe",
          stripe_payment_intent_id: opts.status === "confirmed" ? `pi_staging_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null,
          paid_at: opts.status === "confirmed" ? new Date().toISOString() : null,
        })
        .select("*")
        .single();
      if (error) throw error;
      createdBookingIds.push(data.id);
      return data;
    }

    async function insertReschedule(originalId: string, newId: string, priceDifference: number) {
      // Through the AUTHENTICATED client, deliberately — proves the real
      // self-service INSERT policy works, not just a service-role bypass.
      const { data, error } = await authClient
        .from("booking_reschedules")
        .insert({ original_booking_id: originalId, new_booking_id: newId, price_difference: priceDifference, initiated_by: userId })
        .select("*")
        .single();
      if (error) throw error;
      createdRescheduleIds.push(data.id);
      return data;
    }

    async function getReschedule(id: string) {
      const { rows } = await pg.query(`select * from booking_reschedules where id = $1`, [id]);
      return rows[0];
    }
    async function getBooking(id: string) {
      const { rows } = await pg.query(`select * from bookings where id = $1`, [id]);
      return rows[0];
    }

    // ================================================================
    // Scenario A — complete_reschedule() self-trigger-interference guard
    // ================================================================
    console.log("\n=== Scenario A: complete_reschedule() vs. its own cancellation trigger ===");
    const aOriginal = await insertBooking({ dayOffset: 10, hour: 8, durationHours: 1, priceAmount: 50000, status: "confirmed" });
    const aReplacement = await insertBooking({ dayOffset: 10, hour: 10, durationHours: 1, priceAmount: 50000, status: "pending" });
    const aReschedule = await insertReschedule(aOriginal.id, aReplacement.id, 0);

    const aComplete = await serviceClient.rpc("complete_reschedule", { p_reschedule_id: aReschedule.id, p_refund_id: null });
    record("complete_reschedule() returns true", aComplete.data === true && aComplete.error === null, `data=${aComplete.data} error=${aComplete.error?.message ?? "none"}`);

    const aReplacementAfter = await getBooking(aReplacement.id);
    const aOriginalAfter = await getBooking(aOriginal.id);
    const aRescheduleAfter = await getReschedule(aReschedule.id);
    record("replacement booking is now confirmed", aReplacementAfter.status === "confirmed", `status=${aReplacementAfter.status}`);
    record("original booking is now cancelled", aOriginalAfter.status === "cancelled", `status=${aOriginalAfter.status}`);
    record(
      "reschedule is 'completed', NOT overwritten to 'failed' by its own cancellation trigger (the critical self-interference check)",
      aRescheduleAfter.status === "completed",
      `status=${aRescheduleAfter.status}${aRescheduleAfter.status === "failed" ? ` (failure_reason=${aRescheduleAfter.failure_reason})` : ""}`
    );

    // ================================================================
    // Scenario B — orphan reconciliation trigger
    // ================================================================
    console.log("\n=== Scenario B: orphan reconciliation (replacement cancelled while pending_payment) ===");
    const bOriginal = await insertBooking({ dayOffset: 11, hour: 8, durationHours: 1, priceAmount: 50000, status: "confirmed" });
    const bReplacement = await insertBooking({ dayOffset: 11, hour: 10, durationHours: 1, priceAmount: 70000, status: "pending" });
    const bReschedule = await insertReschedule(bOriginal.id, bReplacement.id, 20000);

    // Cancel the replacement through the ORDINARY customer-initiated
    // path — the exact same update cancelBooking() performs.
    const bCancel = await authClient.from("bookings").update({ status: "cancelled" }).eq("id", bReplacement.id).select("*").single();
    record("ordinary cancellation of the pending replacement succeeds", bCancel.error === null, bCancel.error?.message ?? "OK");

    const bRescheduleAfter = await getReschedule(bReschedule.id);
    record(
      "the trigger transitions the reschedule to 'failed' automatically",
      bRescheduleAfter.status === "failed" && !!bRescheduleAfter.failure_reason,
      `status=${bRescheduleAfter.status} failure_reason=${bRescheduleAfter.failure_reason}`
    );
    const bOriginalAfter = await getBooking(bOriginal.id);
    record("the original booking remains untouched (still confirmed)", bOriginalAfter.status === "confirmed", `status=${bOriginalAfter.status}`);

    // The original should now be eligible for a NEW reschedule attempt —
    // the partial unique index must no longer block it.
    const bReplacement2 = await insertBooking({ dayOffset: 11, hour: 12, durationHours: 1, priceAmount: 50000, status: "pending" });
    let bSecondAttemptOk = true;
    let bSecondAttemptDetail = "inserted successfully";
    try {
      await insertReschedule(bOriginal.id, bReplacement2.id, 0);
    } catch (error) {
      bSecondAttemptOk = false;
      bSecondAttemptDetail = error instanceof Error ? error.message : String(error);
    }
    record("a NEW reschedule attempt on the same original now succeeds (no permanent orphan/deadlock)", bSecondAttemptOk, bSecondAttemptDetail);

    // ================================================================
    // Scenario C — partial unique index (near-concurrent attempts)
    // ================================================================
    console.log("\n=== Scenario C: partial unique index under near-concurrent inserts ===");
    const cOriginal = await insertBooking({ dayOffset: 12, hour: 8, durationHours: 1, priceAmount: 50000, status: "confirmed" });
    const cReplacement1 = await insertBooking({ dayOffset: 12, hour: 10, durationHours: 1, priceAmount: 50000, status: "pending" });
    const cReplacement2 = await insertBooking({ dayOffset: 12, hour: 12, durationHours: 1, priceAmount: 50000, status: "pending" });

    const [cAttempt1, cAttempt2] = await Promise.allSettled([
      authClient.from("booking_reschedules").insert({ original_booking_id: cOriginal.id, new_booking_id: cReplacement1.id, price_difference: 0, initiated_by: userId }).select("*").single(),
      authClient.from("booking_reschedules").insert({ original_booking_id: cOriginal.id, new_booking_id: cReplacement2.id, price_difference: 0, initiated_by: userId }).select("*").single(),
    ]);
    const cResults = [cAttempt1, cAttempt2].map((r) => (r.status === "fulfilled" ? r.value : { data: null, error: r.reason }));
    const cSucceeded = cResults.filter((r) => !r.error && r.data);
    const cFailed = cResults.filter((r) => r.error);
    cSucceeded.forEach((r) => r.data && createdRescheduleIds.push(r.data.id));
    record(
      "exactly one of two near-concurrent reschedule attempts on the same original succeeds",
      cSucceeded.length === 1 && cFailed.length === 1,
      `succeeded=${cSucceeded.length} failed=${cFailed.length}${cFailed[0]?.error ? ` (loser error: ${(cFailed[0].error as { message?: string }).message})` : ""}`
    );

    const { rows: cPendingRows } = await pg.query(
      `select count(*) as n from booking_reschedules where original_booking_id = $1 and status in ('pending_payment','pending_refund')`,
      [cOriginal.id]
    );
    record("exactly one pending reschedule row exists for that original afterward", Number(cPendingRows[0].n) === 1, `count=${cPendingRows[0].n}`);

    // ================================================================
    // Scenario D — pending_refund checkpoint, retry, idempotent completion
    // ================================================================
    console.log("\n=== Scenario D: pending_refund checkpoint + retry + idempotent completion ===");
    const dOriginal = await insertBooking({ dayOffset: 13, hour: 8, durationHours: 1, priceAmount: 70000, status: "confirmed" });
    const dReplacement = await insertBooking({ dayOffset: 13, hour: 10, durationHours: 1, priceAmount: 50000, status: "pending" });
    const dReschedule = await insertReschedule(dOriginal.id, dReplacement.id, -20000);

    // Simulate "a real refund already succeeded" (Phase 3 is DB-only —
    // no live provider call here; Phase 5 covers the real PayMongo/Stripe path).
    const refundInsert = await serviceClient
      .from("booking_refunds")
      .insert({
        booking_id: dOriginal.id,
        payment_provider: "stripe",
        provider_payment_id: dOriginal.stripe_payment_intent_id,
        amount: 20000,
        currency: "PHP",
        status: "succeeded",
        refund_basis: "gross_only",
        initiated_by: userId,
      })
      .select("*")
      .single();
    if (refundInsert.error) throw refundInsert.error;
    createdRefundIds.push(refundInsert.data.id);

    const checkpoint = await serviceClient.rpc("record_reschedule_refund_success", { p_reschedule_id: dReschedule.id, p_refund_id: refundInsert.data.id });
    record("record_reschedule_refund_success() succeeds", checkpoint.data === true, `data=${checkpoint.data} error=${checkpoint.error?.message ?? "none"}`);

    const dRescheduleCheckpointed = await getReschedule(dReschedule.id);
    record(
      "reschedule is durably checkpointed at pending_refund with refund_id set (simulating a completion-RPC crash right here)",
      dRescheduleCheckpointed.status === "pending_refund" && dRescheduleCheckpointed.refund_id === refundInsert.data.id,
      `status=${dRescheduleCheckpointed.status} refund_id=${dRescheduleCheckpointed.refund_id}`
    );
    const dOriginalStillActive = await getBooking(dOriginal.id);
    const dReplacementStillPending = await getBooking(dReplacement.id);
    record("original booking is still active (untouched) at the checkpoint", dOriginalStillActive.status === "confirmed", `status=${dOriginalStillActive.status}`);
    record("replacement booking is still NOT confirmed at the checkpoint", dReplacementStillPending.status === "pending", `status=${dReplacementStillPending.status}`);

    // "Retry" — exactly what retryRescheduleCompletion() does: re-call
    // complete_reschedule() with the ALREADY-checkpointed refund_id, never re-refunding.
    const dRetry = await serviceClient.rpc("complete_reschedule", { p_reschedule_id: dReschedule.id, p_refund_id: dRescheduleCheckpointed.refund_id });
    record("retry (re-calling complete_reschedule with the checkpointed refund_id) succeeds", dRetry.data === true, `data=${dRetry.data} error=${dRetry.error?.message ?? "none"}`);

    const dRescheduleFinal = await getReschedule(dReschedule.id);
    const dOriginalFinal = await getBooking(dOriginal.id);
    const dReplacementFinal = await getBooking(dReplacement.id);
    record("after retry: reschedule is 'completed'", dRescheduleFinal.status === "completed", `status=${dRescheduleFinal.status}`);
    record("after retry: original is cancelled", dOriginalFinal.status === "cancelled", `status=${dOriginalFinal.status}`);
    record("after retry: replacement is confirmed", dReplacementFinal.status === "confirmed", `status=${dReplacementFinal.status}`);

    const { rows: dRefundCountRows } = await pg.query(`select count(*) as n from booking_refunds where booking_id = $1`, [dOriginal.id]);
    record("no second refund was ever created for this booking (still exactly one)", Number(dRefundCountRows[0].n) === 1, `count=${dRefundCountRows[0].n}`);

    // Idempotent completion: calling complete_reschedule() again must be a clean no-op.
    const dIdempotent = await serviceClient.rpc("complete_reschedule", { p_reschedule_id: dReschedule.id, p_refund_id: null });
    record("a further duplicate completion call returns false (idempotent no-op)", dIdempotent.data === false && dIdempotent.error === null, `data=${dIdempotent.data} error=${dIdempotent.error?.message ?? "none"}`);
    const dRescheduleStillFinal = await getReschedule(dReschedule.id);
    record("duplicate call did not change anything", dRescheduleStillFinal.status === "completed", `status=${dRescheduleStillFinal.status}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) {
      console.log("\nFAILURES:");
      failed.forEach((f) => console.log(`  - ${f.check}: ${f.detail}`));
      process.exitCode = 1;
    }
  } finally {
    // --- Cleanup (best-effort, FK-safe order) ------------------------
    console.log("\nCleaning up staging test data...");
    if (createdRescheduleIds.length > 0) {
      await pg.query(`delete from booking_reschedules where id = any($1::uuid[])`, [createdRescheduleIds]).catch((e) => console.error("cleanup reschedules failed:", e.message));
    }
    if (createdRefundIds.length > 0) {
      await pg.query(`delete from booking_refunds where id = any($1::uuid[])`, [createdRefundIds]).catch((e) => console.error("cleanup refunds failed:", e.message));
    }
    if (createdBookingIds.length > 0) {
      await pg.query(`delete from bookings where id = any($1::uuid[])`, [createdBookingIds]).catch((e) => console.error("cleanup bookings failed:", e.message));
    }
    if (courtId) {
      await pg.query(`delete from courts where id = $1`, [courtId]).catch((e) => console.error("cleanup court failed:", e.message));
    }
    if (venueId) {
      await pg.query(`delete from venues where id = $1`, [venueId]).catch((e) => console.error("cleanup venue failed:", e.message));
    }
    console.log("Cleanup done.");
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
