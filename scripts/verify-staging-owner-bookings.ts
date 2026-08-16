/**
 * Live proof of the new owner-booking reads (Phase 3.1/3.2/3.3) against
 * real staging Postgres/RLS — same posture as
 * scripts/verify-staging-owner-schedule.ts, which already proved this for
 * get_owner_court_schedule(). This script proves the plain SELECT-based
 * reads in src/lib/services/ownerBookings.ts (listBookingsForOwner,
 * getBookingDetailForOwner) rely on the SAME real `bookings` RLS policy,
 * not just "the function didn't ask for another owner's data" — a Jest
 * mock can't prove real cross-account enforcement, only a live session
 * against the real database can.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-owner-bookings.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "../src/lib/supabase/types";
import { listBookingsForOwner, getBookingDetailForOwner } from "../src/lib/services/ownerBookings";

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
  let venueAId: string | null = null;
  let venueBId: string | null = null;
  let courtAId: string | null = null;
  let courtBId: string | null = null;
  let bookingAId: string | null = null;
  let bookingBId: string | null = null;
  let ownerAId: string | null = null;
  let ownerBId: string | null = null;
  let customerId: string | null = null;

  try {
    console.log("Creating two disposable venue-owner accounts, plus one customer account...");
    const ownerA = await signUpDisposable(url, anonKey, `owner-bookings-a-${stamp}@air-rally.invalid`, "OwnerBookingsA123!");
    const ownerB = await signUpDisposable(url, anonKey, `owner-bookings-b-${stamp}@air-rally.invalid`, "OwnerBookingsB123!");
    const customer = await signUpDisposable(url, anonKey, `owner-bookings-cust-${stamp}@air-rally.invalid`, "OwnerBookingsCust123!");
    ownerAId = ownerA.userId;
    ownerBId = ownerB.userId;
    customerId = customer.userId;
    await serviceClient.from("profiles").update({ role: "venue_owner" }).eq("id", ownerAId);
    await serviceClient.from("profiles").update({ role: "venue_owner" }).eq("id", ownerBId);
    await serviceClient.from("profiles").update({ display_name: "Staging Test Customer" }).eq("id", customerId);

    const venueA = await serviceClient
      .from("venues")
      .insert({ owner_id: ownerAId, name: "[STAGING-TEST] Owner Bookings A", status: "active", indoor_outdoor: "outdoor", timezone: "Asia/Manila" })
      .select("*")
      .single();
    if (venueA.error) throw venueA.error;
    venueAId = venueA.data.id;

    const venueB = await serviceClient
      .from("venues")
      .insert({ owner_id: ownerBId, name: "[STAGING-TEST] Owner Bookings B", status: "active", indoor_outdoor: "outdoor", timezone: "Asia/Manila" })
      .select("*")
      .single();
    if (venueB.error) throw venueB.error;
    venueBId = venueB.data.id;

    const courtA = await serviceClient
      .from("courts")
      .insert({ venue_id: venueAId, name: "[STAGING-TEST] Court A", hourly_price: 500, status: "active" })
      .select("*")
      .single();
    if (courtA.error) throw courtA.error;
    courtAId = courtA.data.id;

    const courtB = await serviceClient
      .from("courts")
      .insert({ venue_id: venueBId, name: "[STAGING-TEST] Court B", hourly_price: 500, status: "active" })
      .select("*")
      .single();
    if (courtB.error) throw courtB.error;
    courtBId = courtB.data.id;

    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + 25);
    const localDate = targetDate.toISOString().slice(0, 10);

    const bookingA = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtAId,
        user_id: customerId,
        start_time: `${localDate}T01:00:00Z`,
        end_time: `${localDate}T02:00:00Z`,
        status: "confirmed",
        price_amount: 50000,
        currency: "PHP",
        stripe_checkout_session_id: "cs_test_should_never_leak",
      })
      .select("*")
      .single();
    if (bookingA.error) throw bookingA.error;
    bookingAId = bookingA.data.id;
    console.log(`Created real confirmed booking ${bookingAId} at owner A's court`);

    const bookingB = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtBId,
        user_id: customerId,
        start_time: `${localDate}T03:00:00Z`,
        end_time: `${localDate}T04:00:00Z`,
        status: "confirmed",
        price_amount: 60000,
        currency: "PHP",
      })
      .select("*")
      .single();
    if (bookingB.error) throw bookingB.error;
    bookingBId = bookingB.data.id;
    console.log(`Created real confirmed booking ${bookingBId} at owner B's court`);

    console.log("\nCalling listBookingsForOwner() as ownerA (real session, real RLS)...");
    const ownerAUpcoming = await listBookingsForOwner(ownerA.client, ownerAId, "upcoming");
    const ownerASeesOwnBooking = ownerAUpcoming.some((b) => b.id === bookingAId);
    const ownerASeesOtherBooking = ownerAUpcoming.some((b) => b.id === bookingBId);
    record("[owner A] sees their own booking via listBookingsForOwner", ownerASeesOwnBooking, `found=${ownerASeesOwnBooking}`);
    record("[owner A] does NOT see owner B's booking via listBookingsForOwner", !ownerASeesOtherBooking, `leaked=${ownerASeesOtherBooking}`);

    const ownerAOwnBookingRow = ownerAUpcoming.find((b) => b.id === bookingAId);
    const serializedRow = JSON.stringify(ownerAOwnBookingRow ?? {});
    record(
      "[owner A] returned row never contains the stripe_checkout_session_id secret column",
      !serializedRow.includes("cs_test_should_never_leak") && !("stripe_checkout_session_id" in (ownerAOwnBookingRow ?? {})),
      `serialized contains secret=${serializedRow.includes("cs_test_should_never_leak")}`
    );
    record(
      "[owner A] customer name resolved via public_profiles",
      ownerAOwnBookingRow?.customerName === "Staging Test Customer",
      `customerName=${ownerAOwnBookingRow?.customerName}`
    );

    console.log("\nCalling getBookingDetailForOwner() as ownerA for OWN booking, and for owner B's booking...");
    const ownDetail = await getBookingDetailForOwner(ownerA.client, bookingAId);
    record("[owner A] getBookingDetailForOwner returns their own booking", ownDetail?.id === bookingAId, `id=${ownDetail?.id}`);

    const crossDetail = await getBookingDetailForOwner(ownerA.client, bookingBId);
    record("[owner A] getBookingDetailForOwner returns null for owner B's booking (RLS-hidden, not an error)", crossDetail === null, `result=${JSON.stringify(crossDetail)}`);

    console.log("\nCalling listBookingsForOwner() as ownerB — proving the reverse direction too...");
    const ownerBUpcoming = await listBookingsForOwner(ownerB.client, ownerBId, "upcoming");
    const ownerBSeesOwnBooking = ownerBUpcoming.some((b) => b.id === bookingBId);
    const ownerBSeesOtherBooking = ownerBUpcoming.some((b) => b.id === bookingAId);
    record("[owner B] sees their own booking", ownerBSeesOwnBooking, `found=${ownerBSeesOwnBooking}`);
    record("[owner B] does NOT see owner A's booking", !ownerBSeesOtherBooking, `leaked=${ownerBSeesOtherBooking}`);

    console.log("\nCalling listBookingsForOwner() as the CUSTOMER (a player, not an owner) — must get []...");
    const customerAsOwner = await listBookingsForOwner(customer.client, customerId, "upcoming");
    record("[player] a non-owner account gets zero rows from listBookingsForOwner (no venues of their own)", customerAsOwner.length === 0, `rows=${customerAsOwner.length}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    console.log("\nCleaning up staging test data...");
    if (bookingAId) await pg.query(`delete from bookings where id = $1`, [bookingAId]).catch((e) => console.error(e.message));
    if (bookingBId) await pg.query(`delete from bookings where id = $1`, [bookingBId]).catch((e) => console.error(e.message));
    if (courtAId) await pg.query(`delete from courts where id = $1`, [courtAId]).catch((e) => console.error(e.message));
    if (courtBId) await pg.query(`delete from courts where id = $1`, [courtBId]).catch((e) => console.error(e.message));
    if (venueAId) await pg.query(`delete from venues where id = $1`, [venueAId]).catch((e) => console.error(e.message));
    if (venueBId) await pg.query(`delete from venues where id = $1`, [venueBId]).catch((e) => console.error(e.message));
    if (ownerAId) await serviceClient.auth.admin.deleteUser(ownerAId).catch((e) => console.error(e.message));
    if (ownerBId) await serviceClient.auth.admin.deleteUser(ownerBId).catch((e) => console.error(e.message));
    if (customerId) await serviceClient.auth.admin.deleteUser(customerId).catch((e) => console.error(e.message));
    console.log("Cleanup done.");
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
