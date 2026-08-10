/**
 * Manual, live-database proof that the bookings_no_overlap exclusion
 * constraint (supabase/migrations/20260810000004_bookings.sql) actually
 * does what it's supposed to: of two concurrent attempts to book the same
 * court for the same overlapping time, exactly one succeeds.
 *
 * This is deliberately NOT part of `npm test` / Jest / CI. There is no
 * local Postgres/Docker available in this project's dev environment (see
 * ARCHITECTURE.md's Phase 4A testing-strategy note), so the only way to
 * prove the *real* database's behavior — not just that this codebase's
 * error-handling logic is correct, which the mocked Jest suite already
 * covers — is to actually race two real requests against the live
 * project. Run it deliberately, by hand, when you want to re-confirm this.
 *
 * WHAT IT DOES:
 *   1. Signs in as a real test user (credentials from environment
 *      variables only — never hardcoded, never asked for in chat).
 *   2. Asks the live database for a real available slot on a target demo
 *      court (via the same get_available_slots RPC the app itself uses).
 *   3. Fires two concurrent inserts for that exact same court/interval.
 *   4. Asserts exactly one succeeded and the other failed with Postgres
 *      code 23P01 (exclusion_violation) — the actual constraint firing,
 *      not a coincidence.
 *   5. Cancels the winning booking afterward so it doesn't linger as a
 *      real reservation. The row itself is NOT deleted — bookings have no
 *      delete RLS policy anywhere in this schema, by design (see
 *      ARCHITECTURE.md's RLS section); "cancelled" is the correct,
 *      honest cleanup state, identical to what a real user cancelling a
 *      real booking would leave behind.
 *   6. Never touches the [DEMO] venues/courts/reviews/amenities rows
 *      themselves — only inserts one throwaway booking row against an
 *      existing demo court.
 *
 * HOW TO RUN:
 *   Set these environment variables (in your shell, or in a
 *   `.env.local`-style file you load yourself — this script does NOT read
 *   .env.local automatically, so you know exactly what it has access to):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *     BOOKING_TEST_EMAIL
 *     BOOKING_TEST_PASSWORD
 *   Optional:
 *     BOOKING_TEST_COURT_ID  (defaults to the seeded [DEMO] Banilad Pickle
 *                             Club's Court 1 — requires supabase/seed.sql
 *                             to have been run, since it needs real
 *                             operating hours to have any available slots)
 *
 *   Then: npx ts-node scripts/verify-no-double-booking.ts
 *
 *   None of this happens automatically — you run it, you read the result.
 */
import { createClient } from "@supabase/supabase-js";

const DEFAULT_TEST_COURT_ID = "00000000-0000-4000-8001-000000000001"; // [DEMO] Banilad Pickle Club, Court 1

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("See the header comment in this file for the full list and how to run this script.");
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    process.exit(1);
  }
  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");
  const courtId = process.env.BOOKING_TEST_COURT_ID || DEFAULT_TEST_COURT_ID;

  const supabase = createClient(url, key);

  console.log(`Signing in as ${email}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) {
    console.error("Sign-in failed:", authError?.message);
    process.exit(1);
  }
  const userId = authData.user.id;
  console.log(`Signed in as user ${userId}.`);

  // A date comfortably inside the booking window and past the minimum
  // lead time, so get_available_slots has room to find something.
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 2);
  const localDate = targetDate.toISOString().slice(0, 10);

  console.log(`Looking up a real available slot for court ${courtId} on ${localDate}...`);
  const { data: slots, error: slotsError } = await supabase.rpc("get_available_slots", {
    p_court_id: courtId,
    p_local_date: localDate,
    p_duration_minutes: 60,
  });
  if (slotsError) {
    console.error("get_available_slots failed:", slotsError.message);
    process.exit(1);
  }
  if (!slots || slots.length === 0) {
    console.error(
      `No available slots found for ${localDate}. Has supabase/seed.sql been run (it seeds operating hours)? ` +
        "Or try a different BOOKING_TEST_COURT_ID."
    );
    process.exit(1);
  }

  const target = slots[0] as { slot_start: string; slot_end: string };
  console.log(`Racing two concurrent bookings for the exact same interval: ${target.slot_start} - ${target.slot_end}`);

  const insertOnce = () =>
    supabase
      .from("bookings")
      .insert({
        court_id: courtId,
        user_id: userId,
        start_time: target.slot_start,
        end_time: target.slot_end,
        status: "confirmed",
        price_amount: 0,
        currency: "PHP",
      })
      .select("*")
      .single();

  const [resultA, resultB] = await Promise.all([insertOnce(), insertOnce()]);

  const outcomes = [resultA, resultB];
  const succeeded = outcomes.filter((r) => !r.error);
  const rejectedByConstraint = outcomes.filter((r) => r.error?.code === "23P01");
  const rejectedOther = outcomes.filter((r) => r.error && r.error.code !== "23P01");

  console.log("\n--- Result ---");
  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Rejected by bookings_no_overlap (23P01): ${rejectedByConstraint.length}`);
  console.log(`Rejected for another reason: ${rejectedOther.length}`);
  if (rejectedOther.length > 0) {
    console.log("Unexpected error(s):", rejectedOther.map((r) => r.error?.message));
  }

  const winner = succeeded[0]?.data as { id: string } | undefined;
  if (winner) {
    console.log(`\nCancelling the winning test booking (${winner.id}) so it doesn't linger as a real reservation...`);
    const { error: cancelError } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", winner.id);
    if (cancelError) {
      console.error("Cleanup cancel failed (not fatal to the test result):", cancelError.message);
    } else {
      console.log("Cancelled. The row remains (as 'cancelled') — bookings have no delete policy by design.");
    }
  }

  const pass = succeeded.length === 1 && rejectedByConstraint.length === 1 && rejectedOther.length === 0;
  console.log(`\n${pass ? "PASS" : "FAIL"}: ${pass ? "exactly one booking succeeded, the other was rejected by the database's exclusion constraint." : "did not see the expected 1-success/1-constraint-rejection outcome — see details above."}`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
