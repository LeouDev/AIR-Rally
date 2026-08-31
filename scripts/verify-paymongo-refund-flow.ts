/**
 * Manual, live proof that a REAL PayMongo refund actually moves money in
 * TEST MODE — the thing the Jest suite (src/lib/services/__tests__/
 * refunds.test.ts) cannot prove on its own, since PayMongo's provider
 * calls are mocked there. Companion to verify-paymongo-checkout-flow.ts:
 * that script proves a real payment can be captured and confirmed; this
 * one takes an already-confirmed booking from that script and calls the
 * REAL, unmodified requestRefund() (src/lib/services/refunds.ts) against
 * it — no mocking, no shortcuts.
 *
 * THIS SCRIPT FOUND A REAL BUG 2026-08-31 — keep it. The first live run
 * (against a genuine confirmed PayMongo test-mode booking, ₱500, real
 * payment id pay_MTHM59s7jK3y8MgaMPhp7enC) failed with "No such Payment
 * with id pi_...": requestRefund() reads booking.paymongo_payment_intent_id
 * (a PaymentIntent id, stored by the webhook route) and passes it to
 * PayMongo's /v1/payments/{id} endpoint, which wants a Payment id — a
 * structurally different PayMongo object. See the
 * paymongo-refund-gate-narrower-than-needed memory and the commit that
 * added paymongo_payment_id for the fix. Re-running this script after
 * that fix is what "proven, not just no longer throwing" looks like —
 * expect REFUND SUCCEEDED with a real provider_refund_id this time.
 *
 * WHAT IT DOES:
 *   1. Signs in as a real test user (env vars only, never hardcoded).
 *   2. Loads a booking by id — must already be status confirmed/cancelled
 *      with a real captured PayMongo payment (produce one with
 *      verify-paymongo-checkout-flow.ts's create+confirm steps first).
 *   3. Calls the REAL requestRefund() for the booking's full price —
 *      not a mock, the actual module this app ships.
 *   4. Prints the full result: on success, the provider_refund_id PayMongo
 *      actually assigned (verify it in PayMongo's dashboard, don't just
 *      trust this script's own exit code — see the memory above for why
 *      "the code path didn't throw" is not sufficient proof on its own).
 *      On failure, the exact reason and failure_reason PayMongo returned.
 *
 * HOW TO RUN:
 *   The booking must already be confirmed with a real PayMongo payment —
 *   run verify-paymongo-checkout-flow.ts create, pay with the test card,
 *   then confirm, first.
 *
 *   Needs a baseUrl in tsconfig.json for ts-node's module resolution to
 *   follow this app's own `@/` imports (refunds.ts imports paymongo.ts,
 *   paymongoLaunchGates.ts, etc. via `@/lib/...`) — Next's own bundler
 *   doesn't need one, so it may not be present; add
 *   `"baseUrl": "."` next to `"paths"` in tsconfig.json temporarily if
 *   ts-node reports "Cannot find module '@/...'", and revert it after —
 *   it is not required for the app itself to build or run.
 *
 *   Set these environment variables (does NOT read .env.* automatically):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *     BOOKING_TEST_EMAIL
 *     BOOKING_TEST_PASSWORD
 *
 *   Then:
 *     TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *       node -r ts-node/register -r tsconfig-paths/register \
 *       scripts/verify-paymongo-refund-flow.ts <booking-id>
 *
 *   Nothing here cleans up after itself beyond what requestRefund() does
 *   on its own — a successful run really does refund a real (test-mode)
 *   payment. Read the result, don't just check the exit code.
 */
import { createClient } from "@supabase/supabase-js";
import { requestRefund, RefundError } from "../src/lib/services/refunds";
import type { Database } from "../src/lib/supabase/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const bookingId = process.argv[2];
  if (!bookingId) {
    console.error("Usage: verify-paymongo-refund-flow.ts <booking-id>");
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

  const { data: booking, error: bookingError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingError || !booking) {
    console.error("Couldn't load the booking:", bookingError?.message);
    process.exit(1);
  }
  console.log("Booking:", {
    id: booking.id,
    status: booking.status,
    paymongo_payment_intent_id: booking.paymongo_payment_intent_id,
    price_amount: booking.price_amount,
  });

  console.log(`\nCalling the REAL requestRefund() for the full amount (${booking.price_amount} ${booking.currency})...`);
  try {
    const refund = await requestRefund(supabase, {
      booking,
      amount: booking.price_amount,
      reason: "verify-paymongo-refund-flow live proof",
      initiatedBy: authData.user.id,
    });
    console.log("\n--- Result ---");
    console.log(JSON.stringify(refund, null, 2));
    if (refund.status === "succeeded") {
      console.log(
        `\nREFUND SUCCEEDED. provider_refund_id: ${refund.provider_refund_id}. ` +
          "Verify this in PayMongo's TEST MODE dashboard/API before treating this as proof — " +
          "this script exiting 0 is not the proof, the money actually moving is."
      );
      process.exit(0);
    }
    console.log(`\nREFUND DID NOT SUCCEED. status: ${refund.status}, failure_reason: ${refund.failure_reason}`);
    process.exit(1);
  } catch (error) {
    console.log("\n--- REFUND THREW BEFORE REACHING A TERMINAL STATE ---");
    if (error instanceof RefundError) {
      console.log(`reason: ${error.reason}`);
      console.log(`message: ${error.message}`);
    } else {
      console.log(error);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
