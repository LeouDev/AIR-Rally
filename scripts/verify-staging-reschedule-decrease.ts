/**
 * Live proof of the price-DECREASE reschedule flow, using the REAL
 * application code (createCheckoutSession(), reconcilePendingBooking(),
 * createReschedule()) against a REAL Stripe TEST MODE checkout AND a
 * REAL Stripe refund — not a mock, not a reimplementation.
 *
 * A decrease reschedule refunds the price difference against the
 * ORIGINAL booking's own payment_intent, so unlike the increase scenario
 * (verify-staging-reschedule-increase.ts), the original booking here
 * must be paid for with a REAL Stripe checkout first — a fabricated
 * `pi_staging_test_...` payment_intent_id (as used in the other staging
 * scripts, which never touch the refund API) would make Stripe's real
 * refund call 404.
 *
 * Three steps:
 *
 *   create          — creates a pending original booking (₱700, on a
 *                      pricier court) and a REAL Stripe Checkout Session
 *                      for it (via the real createCheckoutSession()).
 *                      Prints the URL to pay (test card 4242 4242 4242
 *                      4242, any future expiry/CVC/ZIP).
 *
 *   confirm-original — after paying, calls the REAL
 *                      reconcilePendingBooking() (the actual "redirect
 *                      arrives before webhook" fallback) to confirm the
 *                      original booking with its real Stripe
 *                      payment_intent_id.
 *
 *   reschedule      — calls the REAL createReschedule() targeting a
 *                      cheaper court, same duration -> real decrease
 *                      branch -> real requestRefund() -> real Stripe
 *                      refund against the original's real payment_intent
 *                      for exactly the ₱200 difference. Verifies the
 *                      refund via Stripe's own API, verifies final DB
 *                      state, cleans up.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","baseUrl":".","paths":{"@/*":["./src/*"]}}' \
 *     node -r tsconfig-paths/register -r ts-node/register scripts/verify-staging-reschedule-decrease.ts create
 *   ... open the printed URL, pay with Stripe's test card ...
 *   ... same invocation with "confirm-original" ...
 *   ... same invocation with "reschedule" ...
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { Client as PgClient } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createReschedule } from "@/lib/services/reschedules";
import { createCheckoutSession } from "@/lib/services/payments";
import { attachCheckoutSession, reconcilePendingBooking } from "@/lib/services/bookings";

const STATE_FILE = path.join(__dirname, ".staging-reschedule-decrease-state.json");

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

type State = {
  venueId: string;
  courtAId: string;
  courtBId: string;
  originalId: string;
  replacementId?: string;
  rescheduleId?: string;
};

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

function saveState(state: State) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    console.error(`No state file found at ${STATE_FILE} — run the "create" step first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
}

async function create() {
  const { serviceClient, pg, userId } = await getClients();
  try {
    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Decrease Reschedule", status: "active", indoor_outdoor: "outdoor" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    const venueId = venueInsert.data.id;

    const courtA = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court A (₱700/hr)", hourly_price: 700, status: "active" }).select("*").single();
    if (courtA.error) throw courtA.error;
    const courtB = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court B (₱500/hr)", hourly_price: 500, status: "active" }).select("*").single();
    if (courtB.error) throw courtB.error;

    await serviceClient.from("venue_operating_hours").insert(Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId, day_of_week: day, start_time: "00:00", end_time: "23:30" })));

    const startTime = daysFromNow(16, 8);
    const endTime = daysFromNow(16, 9);
    const original = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtA.data.id,
        user_id: userId,
        start_time: startTime,
        end_time: endTime,
        status: "pending",
        price_amount: 70000,
        currency: "PHP",
      })
      .select("*")
      .single();
    if (original.error) throw original.error;
    console.log(`Created PENDING original booking ${original.data.id} on Court A (₱700.00)`);

    const session = await createCheckoutSession({
      booking: original.data,
      venueName: "[STAGING-TEST] Decrease Reschedule",
      courtName: "[STAGING-TEST] Court A (₱700/hr)",
      successUrl: "http://localhost:3000/bookings/success",
      cancelUrl: "http://localhost:3000/bookings/cancel",
    });
    if (!session.url) throw new Error("Stripe did not return a session URL.");

    await attachCheckoutSession(serviceClient as never, original.data.id, session.id);

    const state: State = { venueId, courtAId: courtA.data.id, courtBId: courtB.data.id, originalId: original.data.id };
    saveState(state);

    console.log(`\nREAL Stripe TEST MODE checkout URL for the ORIGINAL ₱700.00 booking — open this and pay with card 4242 4242 4242 4242, any future expiry, any CVC/ZIP:\n\n  ${session.url}\n`);
    console.log(`Once paid, re-run this script with "confirm-original".`);
  } finally {
    await pg.end();
  }
}

async function confirmOriginal() {
  const state = loadState();
  const { serviceClient, pg } = await getClients();
  try {
    const before = await pg.query(`select status, stripe_checkout_session_id from bookings where id = $1`, [state.originalId]);
    const sessionId = before.rows[0]?.stripe_checkout_session_id;
    if (!sessionId) throw new Error("Original booking has no stripe_checkout_session_id — did the create step run?");

    console.log("Calling the REAL reconcilePendingBooking() fallback...");
    const reconciled = await reconcilePendingBooking(serviceClient as never, state.originalId, sessionId);
    console.log(`Original booking status after reconciliation: ${reconciled.status}`);
    console.log(`stripe_payment_intent_id: ${reconciled.stripe_payment_intent_id}`);

    if (reconciled.status !== "confirmed" || !reconciled.stripe_payment_intent_id) {
      console.error("Original booking is not confirmed yet — pay via the checkout URL from the create step, then re-run confirm-original.");
      process.exit(1);
    }
    console.log("\nPASS — original booking confirmed with a REAL stripe_payment_intent_id.");
    console.log(`Now re-run this script with "reschedule".`);
  } finally {
    await pg.end();
  }
}

async function reschedule() {
  const state = loadState();
  const { serviceClient, pg, userId } = await getClients();
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    const { rows: originalRows } = await pg.query(`select * from bookings where id = $1`, [state.originalId]);
    const original = originalRows[0];
    record("original booking is confirmed before rescheduling", original?.status === "confirmed", `status=${original?.status}`);
    record("original booking has a real stripe_payment_intent_id (not a fabricated pi_staging_test_ id)", !!original?.stripe_payment_intent_id && !original.stripe_payment_intent_id.startsWith("pi_staging_test_"), `stripe_payment_intent_id=${original?.stripe_payment_intent_id}`);

    console.log("\nCalling the REAL createReschedule() targeting the cheaper court (decrease branch)...");
    const result = await createReschedule(serviceClient as never, userId, {
      bookingId: state.originalId,
      newCourtId: state.courtBId,
      newStartTime: daysFromNow(16, 11),
      newEndTime: daysFromNow(16, 12),
      siteUrl: "http://localhost:3000",
    });

    record("createReschedule() returns kind='completed' (decrease is immediate, no checkout)", result.kind === "completed", `kind=${result.kind}`);
    if (result.kind !== "completed") {
      console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
      process.exitCode = 1;
      return;
    }

    state.replacementId = result.newBooking.id;
    state.rescheduleId = result.reschedule.id;
    saveState(state);

    record("reschedule status is completed with price_difference=-20000 (₱200.00 decrease)", result.reschedule.status === "completed" && result.reschedule.price_difference === -20000, `status=${result.reschedule.status} price_difference=${result.reschedule.price_difference}`);
    record("replacement booking is confirmed at its own price (₱500.00)", result.newBooking.status === "confirmed" && result.newBooking.price_amount === 50000, `status=${result.newBooking.status} price_amount=${result.newBooking.price_amount}`);
    record("original booking is now cancelled", result.originalBooking.status === "cancelled", `status=${result.originalBooking.status}`);

    const { rows: refundRows } = await pg.query(`select * from booking_refunds where booking_id = $1 order by created_at desc limit 1`, [state.originalId]);
    const refund = refundRows[0];
    record("a booking_refunds row exists for the original booking", !!refund, `refund=${refund?.id}`);
    record("refund status is 'succeeded'", refund?.status === "succeeded", `status=${refund?.status}`);
    record("refund amount is exactly ₱200.00 (20000 minor units) — the price difference, never the full ₱700", refund?.amount === 20000, `amount=${refund?.amount}`);
    record("refund_basis is 'gross_only' (V1 rule)", refund?.refund_basis === "gross_only", `refund_basis=${refund?.refund_basis}`);
    record("refund is linked against the original's real payment_intent, not a fabricated one", refund?.provider_payment_id === original.stripe_payment_intent_id, `provider_payment_id=${refund?.provider_payment_id}`);

    if (refund?.provider_refund_id) {
      console.log(`\nIndependently verifying the refund via Stripe's own API (refund id ${refund.provider_refund_id})...`);
      const stripeRefund = await stripe.refunds.retrieve(refund.provider_refund_id);
      record("Stripe's own API reports this refund as a real, succeeded refund", stripeRefund.status === "succeeded", `stripe status=${stripeRefund.status}`);
      record("Stripe's own API reports the exact same amount (20000)", stripeRefund.amount === 20000, `stripe amount=${stripeRefund.amount}`);
      record("Stripe's own API confirms the refund is against the original's real payment_intent", stripeRefund.payment_intent === original.stripe_payment_intent_id, `stripe payment_intent=${stripeRefund.payment_intent}`);
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;

    console.log("\nCleaning up staging test data...");
    await pg.query(`delete from booking_reschedules where id = $1`, [state.rescheduleId]).catch((e) => console.error(e.message));
    await pg.query(`delete from booking_refunds where booking_id = $1`, [state.originalId]).catch((e) => console.error(e.message));
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
else if (mode === "confirm-original") confirmOriginal().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "reschedule") reschedule().catch((e) => { console.error(e); process.exit(1); });
else {
  console.error('Usage: verify-staging-reschedule-decrease.ts <create|confirm-original|reschedule>');
  process.exit(1);
}
