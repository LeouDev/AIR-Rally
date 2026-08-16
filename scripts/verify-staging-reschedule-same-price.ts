/**
 * Live proof that createReschedule() — the REAL application function,
 * imported directly, not reimplemented — completes a same-price
 * reschedule immediately with no checkout and no refund, against real
 * staging Postgres. No payment provider call needed for this scenario
 * (V1 rule: same price means no financial step at all).
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","baseUrl":".","paths":{"@/*":["./src/*"]}}' \
 *     node -r tsconfig-paths/register -r ts-node/register scripts/verify-staging-reschedule-same-price.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { createReschedule } from "@/lib/services/reschedules";

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
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

  let venueId: string | null = null;
  let courtId: string | null = null;
  const createdBookingIds: string[] = [];

  try {
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
    if (signInError || !signInData.user) throw new Error(`Could not sign in: ${signInError?.message}`);
    const userId = signInData.user.id;
    console.log(`Signed in as ${email} (uid=${userId})\n`);

    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Same-Price Reschedule", status: "active", indoor_outdoor: "outdoor" })
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

    // Give the venue operating hours covering the whole test window, so
    // createBooking()'s own is_court_time_bookable() pre-check (called
    // from inside the REAL createReschedule() -> createBooking() path)
    // finds the replacement slot genuinely available.
    const { error: hoursError } = await serviceClient.from("venue_operating_hours").insert(
      Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId, day_of_week: day, start_time: "00:00", end_time: "23:30" }))
    );
    if (hoursError) throw hoursError;

    const originalStart = daysFromNow(14, 8);
    const originalEnd = daysFromNow(14, 9);
    const originalInsert = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtId,
        user_id: userId,
        start_time: originalStart,
        end_time: originalEnd,
        status: "confirmed",
        price_amount: 50000,
        currency: "PHP",
        payment_provider: "stripe",
        stripe_payment_intent_id: `pi_staging_test_${Date.now()}`,
        paid_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (originalInsert.error) throw originalInsert.error;
    createdBookingIds.push(originalInsert.data.id);
    console.log(`Created confirmed original booking ${originalInsert.data.id} (₱500.00)\n`);

    // Call the REAL createReschedule() — same court, same duration
    // (60 min), different time slot the SAME day -> identical price.
    const result = await createReschedule(serviceClient as never, userId, {
      bookingId: originalInsert.data.id,
      newCourtId: courtId as string,
      newStartTime: daysFromNow(14, 11),
      newEndTime: daysFromNow(14, 12),
      siteUrl: "https://staging-verification.invalid",
    });

    record("createReschedule() returns kind='completed'", result.kind === "completed", `kind=${result.kind}`);
    if (result.kind === "completed") {
      createdBookingIds.push(result.newBooking.id);
      record("replacement booking is confirmed", result.newBooking.status === "confirmed", `status=${result.newBooking.status}`);
      record("replacement price equals the original (same price)", result.newBooking.price_amount === 50000, `price_amount=${result.newBooking.price_amount}`);
      record("original booking is cancelled", result.originalBooking.status === "cancelled", `status=${result.originalBooking.status}`);
      record("reschedule status is completed with price_difference=0", result.reschedule.status === "completed" && result.reschedule.price_difference === 0, `status=${result.reschedule.status} price_difference=${result.reschedule.price_difference}`);

      const { rows: refundRows } = await pg.query(`select count(*) as n from booking_refunds where booking_id = $1`, [originalInsert.data.id]);
      record("no refund was created for a same-price reschedule", Number(refundRows[0].n) === 0, `count=${refundRows[0].n}`);
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    console.log("\nCleaning up staging test data...");
    if (createdBookingIds.length > 0) {
      await pg.query(`delete from booking_reschedules where original_booking_id = any($1::uuid[]) or new_booking_id = any($1::uuid[])`, [createdBookingIds]).catch((e) => console.error(e.message));
      await pg.query(`delete from bookings where id = any($1::uuid[])`, [createdBookingIds]).catch((e) => console.error(e.message));
    }
    if (courtId) await pg.query(`delete from venue_operating_hours where venue_id = $1`, [venueId]).catch((e) => console.error(e.message));
    if (courtId) await pg.query(`delete from courts where id = $1`, [courtId]).catch((e) => console.error(e.message));
    if (venueId) await pg.query(`delete from venues where id = $1`, [venueId]).catch((e) => console.error(e.message));
    console.log("Cleanup done.");
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
