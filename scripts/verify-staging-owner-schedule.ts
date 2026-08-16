/**
 * Live proof of get_owner_court_schedule() (P1.1) against real staging
 * Postgres/RLS. Creates a disposable venue/court owned by a fresh test
 * account, a real confirmed booking, and a real block, then proves the
 * RPC correctly classifies each, and that a DIFFERENT owner gets zero
 * rows for a court they don't own.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-owner-schedule.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "../src/lib/supabase/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function signUpDisposable(url: string, anonKey: string, email: string, password: string) {
  const client = createClient<Database>(url, anonKey);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) throw new Error(`Sign-up failed for ${email}: ${error?.message}`);
  return { client, userId: data.user.id };
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const serviceClient = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  const stamp = Date.now();
  let venueId: string | null = null;
  let courtId: string | null = null;
  let bookingId: string | null = null;
  let blockId: string | null = null;
  let ownerAId: string | null = null;
  let ownerBId: string | null = null;

  try {
    console.log("Creating two disposable venue-owner test accounts...");
    const ownerA = await signUpDisposable(url, anonKey, `owner-schedule-a-${stamp}@air-rally.invalid`, "OwnerScheduleA123!");
    const ownerB = await signUpDisposable(url, anonKey, `owner-schedule-b-${stamp}@air-rally.invalid`, "OwnerScheduleB123!");
    ownerAId = ownerA.userId;
    ownerBId = ownerB.userId;
    await serviceClient.from("profiles").update({ role: "venue_owner" }).eq("id", ownerAId);
    await serviceClient.from("profiles").update({ role: "venue_owner" }).eq("id", ownerBId);

    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: ownerAId, name: "[STAGING-TEST] Owner Schedule", status: "active", indoor_outdoor: "outdoor", timezone: "Asia/Manila" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    venueId = venueInsert.data.id;

    const courtInsert = await serviceClient
      .from("courts")
      .insert({ venue_id: venueId, name: "[STAGING-TEST] Court A", hourly_price: 500, status: "active" })
      .select("*")
      .single();
    if (courtInsert.error) throw courtInsert.error;
    courtId = courtInsert.data.id;

    await serviceClient.from("venue_operating_hours").insert(
      Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId as string, day_of_week: day, start_time: "00:00", end_time: "23:00" }))
    );

    // A fixed future date so the test is deterministic.
    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + 20);
    const localDate = targetDate.toISOString().slice(0, 10);
    const bookingStart = `${localDate}T01:00:00Z`; // 09:00 Asia/Manila
    const bookingEnd = `${localDate}T02:00:00Z`;
    const blockStart = `${localDate}T03:00:00Z`; // 11:00 Asia/Manila
    const blockEnd = `${localDate}T04:00:00Z`;

    const bookingInsert = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtId,
        user_id: ownerBId, // any real profile works as the "customer" here
        start_time: bookingStart,
        end_time: bookingEnd,
        status: "confirmed",
        price_amount: 50000,
        currency: "PHP",
      })
      .select("*")
      .single();
    if (bookingInsert.error) throw bookingInsert.error;
    bookingId = bookingInsert.data.id;
    console.log(`Created real confirmed booking ${bookingId}`);

    const blockInsert = await serviceClient
      .from("court_blocked_periods")
      .insert({ court_id: courtId, start_time: blockStart, end_time: blockEnd, reason: "Maintenance", created_by: ownerAId })
      .select("*")
      .single();
    if (blockInsert.error) throw blockInsert.error;
    blockId = blockInsert.data.id;
    console.log(`Created real block ${blockId}`);

    console.log("\nCalling the REAL get_owner_court_schedule() as the OWNER (ownerA)...");
    const { data: schedule, error: scheduleError } = await ownerA.client.rpc("get_owner_court_schedule", {
      p_court_id: courtId,
      p_local_date: localDate,
      p_duration_minutes: 60,
      p_increment_minutes: 60,
    });
    if (scheduleError) throw scheduleError;

    // Postgres serializes timestamptz as e.g. "...+00:00", not the literal
    // "...Z" strings this script constructs — compare by instant, not string.
    const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

    const bookedSlot = (schedule ?? []).find((s) => sameInstant(s.slot_start, bookingStart));
    const blockedSlot = (schedule ?? []).find((s) => sameInstant(s.slot_start, blockStart));
    const availableSlot = (schedule ?? []).find((s) => sameInstant(s.slot_start, `${localDate}T05:00:00Z`));

    record("[owner] booked slot classified correctly", bookedSlot?.status === "booked" && bookedSlot?.booking_id === bookingId, `status=${bookedSlot?.status} booking_id=${bookedSlot?.booking_id}`);
    record("[owner] blocked slot classified correctly, reason visible", blockedSlot?.status === "blocked" && blockedSlot?.block_reason === "Maintenance", `status=${blockedSlot?.status} reason=${blockedSlot?.block_reason}`);
    record("[owner] untouched slot classified as available", availableSlot?.status === "available", `status=${availableSlot?.status}`);

    console.log("\nCalling the SAME RPC as a DIFFERENT owner (ownerB) who doesn't own this court...");
    const { data: otherSchedule, error: otherError } = await ownerB.client.rpc("get_owner_court_schedule", {
      p_court_id: courtId,
      p_local_date: localDate,
    });
    record("[cross-owner] a different owner gets ZERO rows, not another owner's data", !otherError && (otherSchedule ?? []).length === 0, `error=${otherError?.message} rows=${otherSchedule?.length}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    console.log("\nCleaning up staging test data...");
    if (blockId) await pg.query(`delete from court_blocked_periods where id = $1`, [blockId]).catch((e) => console.error(e.message));
    if (bookingId) await pg.query(`delete from bookings where id = $1`, [bookingId]).catch((e) => console.error(e.message));
    if (courtId) await pg.query(`delete from venue_operating_hours where venue_id = $1`, [venueId]).catch((e) => console.error(e.message));
    if (courtId) await pg.query(`delete from courts where id = $1`, [courtId]).catch((e) => console.error(e.message));
    if (venueId) await pg.query(`delete from venues where id = $1`, [venueId]).catch((e) => console.error(e.message));
    if (ownerAId) await serviceClient.auth.admin.deleteUser(ownerAId).catch((e) => console.error(e.message));
    if (ownerBId) await serviceClient.auth.admin.deleteUser(ownerBId).catch((e) => console.error(e.message));
    console.log("Cleanup done.");
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
