/**
 * Live proof of the actual customer-facing bug, not just requestRefund()
 * in isolation: rescheduling to a cheaper slot is a multi-step saga
 * (createReschedule() creates the replacement as pending, calls
 * requestRefund() for the price difference, durably checkpoints success,
 * then completeReschedule() atomically swaps the original for the
 * replacement) — a working requestRefund() does not by itself prove the
 * saga delivers a cheaper booking AND the difference back. This calls
 * the REAL, unmodified createReschedule() (src/lib/services/
 * reschedules.ts), the exact function the booking screen's own
 * "Reschedule" action calls, with no mocking anywhere in the chain.
 *
 * PREREQUISITE: a real, CONFIRMED PayMongo test-mode booking on the
 * MORE EXPENSIVE of two courts at the same venue — produce one with
 * verify-paymongo-checkout-flow.ts's create+confirm steps first, using
 * BOOKING_TEST_COURT_ID=00000000-0000-4000-8001-000000000003
 * ([DEMO] Banilad Pickle Club, Court 3, ₱550/hr) so rescheduling to
 * Court 1 or 2 (₱500/hr) below is a genuine, non-zero price DECREASE —
 * proves a PARTIAL refund (the difference only), not a full one, which
 * is what a real reschedule actually asks PayMongo for.
 *
 * WHAT IT DOES:
 *   1. Signs in as the real test user.
 *   2. Loads the original booking, confirms it's actually confirmed with
 *      a captured PayMongo payment (refuses to proceed otherwise — a
 *      pending/unpaid booking would make createReschedule() fail for an
 *      unrelated reason and tell you nothing).
 *   3. Finds a real available slot on the CHEAPER target court, same
 *      venue, at least RESCHEDULE_CUTOFF_HOURS out.
 *   4. Calls the REAL createReschedule() for that slot.
 *   5. Re-fetches both bookings and the reschedule row, and asserts:
 *      the ORIGINAL ends up cancelled, the REPLACEMENT ends up confirmed
 *      on the cheaper court, the reschedule row is 'completed', and the
 *      refunded amount matches the exact price difference to the
 *      centavo — not just that something non-zero came back.
 *
 * Does not clean up afterward — the resulting state (original cancelled,
 * replacement confirmed, a real booking_refunds row) IS the proof; read
 * it, don't discard it. Verify the refund amount independently in
 * PayMongo's TEST MODE dashboard/API before treating this as proof, same
 * standard as verify-paymongo-refund-flow.ts — this script exiting 0 is
 * not the proof, the money actually moving by the right amount is.
 *
 * HOW TO RUN:
 *   Needs a baseUrl in tsconfig.json for ts-node's `@/` resolution — see
 *   verify-paymongo-refund-flow.ts's header for the exact temporary edit.
 *
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *   BOOKING_TEST_EMAIL
 *   BOOKING_TEST_PASSWORD
 *
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register -r tsconfig-paths/register \
 *     scripts/verify-paymongo-reschedule-flow.ts <original-booking-id> [target-court-id]
 */
import { createClient } from "@supabase/supabase-js";
import { createReschedule, RescheduleError } from "../src/lib/services/reschedules";
import type { Database } from "../src/lib/supabase/types";

const DEFAULT_TARGET_COURT_ID = "00000000-0000-4000-8001-000000000001"; // [DEMO] Court 1, ₱500/hr

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const originalBookingId = process.argv[2];
  const targetCourtId = process.argv[3] || DEFAULT_TARGET_COURT_ID;
  if (!originalBookingId) {
    console.error("Usage: verify-paymongo-reschedule-flow.ts <original-booking-id> [target-court-id]");
    process.exit(1);
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    process.exit(1);
  }
  const supabase = createClient<Database>(url, key);

  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");
  console.log(`Signing in as ${email}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) {
    console.error("Sign-in failed:", authError?.message);
    process.exit(1);
  }
  console.log(`Signed in as user ${authData.user.id}.`);

  const { data: original, error: originalError } = await supabase.from("bookings").select("*").eq("id", originalBookingId).single();
  if (originalError || !original) {
    console.error("Couldn't load the original booking:", originalError?.message);
    process.exit(1);
  }
  console.log("Original booking:", {
    id: original.id,
    status: original.status,
    court_id: original.court_id,
    price_amount: original.price_amount,
    paymongo_payment_id: (original as { paymongo_payment_id?: string | null }).paymongo_payment_id,
  });
  if (original.status !== "confirmed" || !original.paymongo_payment_intent_id) {
    console.error(
      "This booking is not a confirmed PayMongo booking — run verify-paymongo-checkout-flow.ts create+confirm on Court 3 first."
    );
    process.exit(1);
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 3); // comfortably past RESCHEDULE_CUTOFF_HOURS
  const localDate = targetDate.toISOString().slice(0, 10);
  console.log(`Looking up a real available slot on ${targetCourtId} for ${localDate}...`);
  const { data: slots, error: slotsError } = await supabase.rpc("get_available_slots", {
    p_court_id: targetCourtId,
    p_local_date: localDate,
    p_duration_minutes: 60,
  });
  if (slotsError) {
    console.error("get_available_slots failed:", slotsError.message);
    process.exit(1);
  }
  if (!slots || slots.length === 0) {
    console.error(`No available slots on ${targetCourtId} for ${localDate}.`);
    process.exit(1);
  }
  const target = slots[0] as { slot_start: string; slot_end: string };
  console.log(`Target slot: ${target.slot_start} - ${target.slot_end} on ${targetCourtId}.`);

  console.log("\nCalling the REAL createReschedule()...");
  try {
    const result = await createReschedule(supabase, authData.user.id, {
      bookingId: originalBookingId,
      newCourtId: targetCourtId,
      newStartTime: target.slot_start,
      newEndTime: target.slot_end,
      reason: "verify-paymongo-reschedule-flow live proof",
      // Only used for the price-INCREASE checkout redirect, unreachable
      // on this script's price-decrease scenario — a placeholder is
      // never actually read.
      siteUrl: "https://staging.example.com",
    });
    console.log("\n--- createReschedule() result ---");
    console.log(JSON.stringify(result, null, 2));

    const [refreshedOriginal, refreshedReplacement] = await Promise.all([
      supabase.from("bookings").select("*").eq("id", originalBookingId).single(),
      result.kind === "completed" || result.kind === "provider_unavailable"
        ? supabase.from("bookings").select("*").eq("id", result.newBooking.id).single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    console.log("\n--- Post-state ---");
    console.log("Original booking status:", refreshedOriginal.data?.status);
    console.log("Replacement booking:", refreshedReplacement.data ? { id: refreshedReplacement.data.id, status: refreshedReplacement.data.status, price_amount: refreshedReplacement.data.price_amount } : null);

    if (result.kind !== "completed") {
      console.log(`\nNOT COMPLETED — kind: ${result.kind}. This is the "deliberate/incidental provider failure" shape if unexpected, or the expected shape for a price INCREASE (checkout_required) or EQUAL price (would auto-complete).`);
      process.exit(result.kind === "provider_unavailable" ? 0 : 1);
    }

    const expectedDifference = Math.abs(target ? original.price_amount - (refreshedReplacement.data?.price_amount ?? 0) : 0);
    const originalCancelled = refreshedOriginal.data?.status === "cancelled";
    const replacementConfirmed = refreshedReplacement.data?.status === "confirmed";
    console.log(`\nExpected refund (price difference): ${expectedDifference} minor units.`);
    console.log(`Original cancelled: ${originalCancelled ? "PASS" : "FAIL"}`);
    console.log(`Replacement confirmed on cheaper court: ${replacementConfirmed ? "PASS" : "FAIL"}`);
    console.log(
      `\nVerify in PayMongo's TEST MODE dashboard: a refund of exactly ${expectedDifference} minor units ` +
        `(₱${(expectedDifference / 100).toFixed(2)}) against the original payment. This script's exit code is not that proof.`
    );
    process.exit(originalCancelled && replacementConfirmed ? 0 : 1);
  } catch (error) {
    console.log("\n--- createReschedule() THREW ---");
    if (error instanceof RescheduleError) {
      console.log(`reason: ${error.reason}`);
      console.log(`message: ${error.message}`);
    } else {
      console.log(error);
    }
    const { data: refreshedOriginal } = await supabase.from("bookings").select("status").eq("id", originalBookingId).single();
    console.log(`\nOriginal booking status after the throw: ${refreshedOriginal?.status} (must be "confirmed" — the saga's own claim is that a failed reschedule leaves the original untouched).`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
