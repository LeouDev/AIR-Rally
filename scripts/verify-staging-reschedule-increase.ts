/**
 * Live proof of the price-increase reschedule flow, using the REAL
 * application code (createReschedule(), maybeCompleteRescheduleFromProvider())
 * against a REAL Stripe TEST MODE checkout — not a mock, not a
 * reimplementation.
 *
 * Two steps, same convention as scripts/verify-stripe-webhook-flow.ts:
 *
 *   create  — creates a confirmed original booking (₱500, on a cheaper
 *             court) directly, then calls the REAL createReschedule()
 *             targeting a pricier court (₱700, same duration) — this
 *             makes a REAL Stripe API call to create a REAL Checkout
 *             Session for exactly the ₱200 difference. Prints the
 *             checkout URL to open and pay (Stripe's test card:
 *             4242 4242 4242 4242, any future expiry/CVC/ZIP) and
 *             writes the IDs needed for the confirm step to a state file.
 *
 *   confirm — reads the state file, independently verifies via a REAL
 *             Stripe API call that the session's amount_total is exactly
 *             the difference (never the replacement's full price), then
 *             calls the REAL maybeCompleteRescheduleFromProvider() — the
 *             actual "confirmation page loads before the webhook" fallback
 *             code path — and verifies final DB state. Cleans up
 *             afterward.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","baseUrl":".","paths":{"@/*":["./src/*"]}}' \
 *     node -r tsconfig-paths/register -r ts-node/register scripts/verify-staging-reschedule-increase.ts create
 *   ... open the printed URL, pay with Stripe's test card ...
 *   ... same invocation with `confirm` instead of `create` ...
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createReschedule, maybeCompleteRescheduleFromProvider } from "@/lib/services/reschedules";
import { retrieveCheckoutSession } from "@/lib/services/payments";

const STATE_FILE = path.join(__dirname, ".staging-reschedule-increase-state.json");

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

type State = { venueId: string; courtAId: string; courtBId: string; originalId: string; replacementId: string; rescheduleId: string; checkoutUrl: string };

async function getClients() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const authClient = createClient(url, anonKey);
  const serviceClient = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");
  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) throw new Error(`Could not sign in: ${signInError?.message}`);
  return { authClient, serviceClient, pg, userId: signInData.user.id };
}

async function create() {
  const { serviceClient, pg, userId } = await getClients();
  try {
    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Increase Reschedule", status: "active", indoor_outdoor: "outdoor" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    const venueId = venueInsert.data.id;

    const courtA = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court A (₱500/hr)", hourly_price: 500, status: "active" }).select("*").single();
    if (courtA.error) throw courtA.error;
    const courtB = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court B (₱700/hr)", hourly_price: 700, status: "active" }).select("*").single();
    if (courtB.error) throw courtB.error;

    await serviceClient.from("venue_operating_hours").insert(Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId, day_of_week: day, start_time: "00:00", end_time: "23:30" })));

    const original = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtA.data.id,
        user_id: userId,
        start_time: daysFromNow(15, 8),
        end_time: daysFromNow(15, 9),
        status: "confirmed",
        price_amount: 50000,
        currency: "PHP",
        payment_provider: "stripe",
        stripe_payment_intent_id: `pi_staging_test_${Date.now()}`,
        paid_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (original.error) throw original.error;
    console.log(`Created confirmed original booking ${original.data.id} on Court A (₱500.00)`);

    const siteUrl = "http://localhost:3000"; // never actually navigated to — only used to build a URL string the real code path expects
    const result = await createReschedule(serviceClient as never, userId, {
      bookingId: original.data.id,
      newCourtId: courtB.data.id,
      newStartTime: daysFromNow(15, 11),
      newEndTime: daysFromNow(15, 12),
      siteUrl,
    });

    if (result.kind !== "checkout_required") {
      throw new Error(`Expected kind='checkout_required', got '${result.kind}' — ${JSON.stringify(result)}`);
    }

    const state: State = {
      venueId,
      courtAId: courtA.data.id,
      courtBId: courtB.data.id,
      originalId: original.data.id,
      replacementId: result.newBooking.id,
      rescheduleId: result.reschedule.id,
      checkoutUrl: result.checkoutUrl,
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    console.log(`\nReplacement booking ${result.newBooking.id} on Court B (₱700.00, expected difference ₱200.00)`);
    console.log(`Reschedule ${result.reschedule.id}, status=${result.reschedule.status}, price_difference=${result.reschedule.price_difference}`);
    console.log(`\nREAL Stripe TEST MODE checkout URL — open this and pay with card 4242 4242 4242 4242, any future expiry, any CVC/ZIP:\n\n  ${result.checkoutUrl}\n`);
    console.log(`Once paid, re-run this script with "confirm" instead of "create".`);
  } finally {
    await pg.end();
  }
}

async function confirm() {
  if (!existsSync(STATE_FILE)) {
    console.error(`No state file found at ${STATE_FILE} — run the "create" step first.`);
    process.exit(1);
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  const { serviceClient, pg } = await getClients();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    const { rows: replacementRows } = await pg.query(`select stripe_checkout_session_id from bookings where id = $1`, [state.replacementId]);
    const sessionId = replacementRows[0]?.stripe_checkout_session_id;
    record("replacement booking has the difference checkout's session id attached", !!sessionId, `stripe_checkout_session_id=${sessionId}`);

    const session = await retrieveCheckoutSession(sessionId);
    record("Stripe reports the session as paid", session.payment_status === "paid", `payment_status=${session.payment_status}`);
    record(
      "Stripe's REAL charged amount is EXACTLY the difference (₱200.00 = 20000), never the replacement's full price (₱700.00 = 70000)",
      session.amount_total === 20000,
      `amount_total=${session.amount_total}`
    );

    if (session.payment_status !== "paid") {
      console.log("\nPayment not confirmed by Stripe yet — pay via the checkout URL from the create step, then re-run confirm.");
      return;
    }

    const completed = await maybeCompleteRescheduleFromProvider(serviceClient as never, state.replacementId);
    record("maybeCompleteRescheduleFromProvider() (the REAL confirmation-page fallback) completes the reschedule", completed === true, `returned ${completed}`);

    const { rows: rescheduleRows } = await pg.query(`select * from booking_reschedules where id = $1`, [state.rescheduleId]);
    const { rows: originalRows } = await pg.query(`select * from bookings where id = $1`, [state.originalId]);
    const { rows: newRows } = await pg.query(`select * from bookings where id = $1`, [state.replacementId]);

    record("reschedule is now 'completed'", rescheduleRows[0]?.status === "completed", `status=${rescheduleRows[0]?.status}`);
    record("original booking is now cancelled", originalRows[0]?.status === "cancelled", `status=${originalRows[0]?.status}`);
    record("replacement booking is now confirmed at its own full price (₱700.00)", newRows[0]?.status === "confirmed" && newRows[0]?.price_amount === 70000, `status=${newRows[0]?.status} price_amount=${newRows[0]?.price_amount}`);
    record("original booking's OWN payment fields were never touched by the difference payment", originalRows[0]?.stripe_payment_intent_id?.startsWith("pi_staging_test_"), `stripe_payment_intent_id=${originalRows[0]?.stripe_payment_intent_id}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;

    console.log("\nCleaning up staging test data...");
    await pg.query(`delete from booking_reschedules where id = $1`, [state.rescheduleId]).catch((e) => console.error(e.message));
    await pg.query(`delete from bookings where id = any($1::uuid[])`, [[state.originalId, state.replacementId]]).catch((e) => console.error(e.message));
    await pg.query(`delete from venue_operating_hours where venue_id = $1`, [state.venueId]).catch((e) => console.error(e.message));
    await pg.query(`delete from courts where id = any($1::uuid[])`, [[state.courtAId, state.courtBId]]).catch((e) => console.error(e.message));
    await pg.query(`delete from venues where id = $1`, [state.venueId]).catch((e) => console.error(e.message));
    console.log("Cleanup done.");
  } finally {
    await pg.end();
  }
}

const mode = process.argv[2];
if (mode === "create") create().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "confirm") confirm().catch((e) => { console.error(e); process.exit(1); });
else {
  console.error('Usage: verify-staging-reschedule-increase.ts <create|confirm>');
  process.exit(1);
}
