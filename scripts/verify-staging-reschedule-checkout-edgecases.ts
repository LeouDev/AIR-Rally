/**
 * Live proof of three reschedule checkout edge cases against real staging
 * Postgres + real Stripe TEST MODE, using the REAL application functions
 * (createReschedule(), resumeRescheduleCheckout(), maybeCompleteReschedule(),
 * maybeCompleteRescheduleFromProvider()) — not reimplementations:
 *
 *   1. Abandoned checkout: an increase reschedule's checkout is created
 *      but never paid — the original booking must stay confirmed and
 *      untouched, the reschedule must stay pending_payment.
 *   2. Stale-session rejection (finding B4): resumeRescheduleCheckout()
 *      supersedes the original checkout with a fresh one (expiring the
 *      old Stripe session + overwriting the stored session id). The REAL
 *      maybeCompleteReschedule() is then called directly with the OLD,
 *      superseded session id — it must reject (return false), proving a
 *      late/duplicate webhook from an old session can never complete a
 *      reschedule that's already moved on to a newer checkout attempt.
 *   3. Duplicate completion idempotency: after paying the NEW session and
 *      completing for real, calling the real completion path a second
 *      time must be a safe no-op (false), never a second write.
 *
 * Three steps:
 *   create   — sets up venue/courts, a confirmed original, and a REAL
 *              increase-reschedule checkout session (session A). Does
 *              NOT pay it.
 *   resume   — verifies the abandoned state, then calls the REAL
 *              resumeRescheduleCheckout() to get session B, verifies
 *              session A is now Stripe-reported "expired", verifies the
 *              REAL maybeCompleteReschedule() rejects session A's id.
 *              Prints session B's checkout URL to pay.
 *   confirm  — after paying session B, calls the REAL
 *              maybeCompleteRescheduleFromProvider(), verifies final
 *              state, calls it again to prove idempotency, cleans up.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","baseUrl":".","paths":{"@/*":["./src/*"]}}' \
 *     node -r tsconfig-paths/register -r ts-node/register scripts/verify-staging-reschedule-checkout-edgecases.ts create
 *   ... same invocation with "resume" ...
 *   ... open the printed URL, pay with Stripe's test card ...
 *   ... same invocation with "confirm" ...
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { Client as PgClient } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createReschedule, resumeRescheduleCheckout, maybeCompleteReschedule, maybeCompleteRescheduleFromProvider } from "@/lib/services/reschedules";

const STATE_FILE = path.join(__dirname, ".staging-reschedule-edgecases-state.json");

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
  replacementId: string;
  rescheduleId: string;
  sessionA: string;
  sessionB?: string;
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
      .insert({ owner_id: userId, name: "[STAGING-TEST] Checkout Edge Cases", status: "active", indoor_outdoor: "outdoor" })
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
        start_time: daysFromNow(17, 8),
        end_time: daysFromNow(17, 9),
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

    const result = await createReschedule(serviceClient as never, userId, {
      bookingId: original.data.id,
      newCourtId: courtB.data.id,
      newStartTime: daysFromNow(17, 11),
      newEndTime: daysFromNow(17, 12),
      siteUrl: "http://localhost:3000",
    });
    if (result.kind !== "checkout_required") throw new Error(`Expected kind='checkout_required', got '${result.kind}'`);

    const { rows } = await pg.query(`select stripe_checkout_session_id from bookings where id = $1`, [result.newBooking.id]);
    const sessionA = rows[0].stripe_checkout_session_id as string;

    const state: State = {
      venueId,
      courtAId: courtA.data.id,
      courtBId: courtB.data.id,
      originalId: original.data.id,
      replacementId: result.newBooking.id,
      rescheduleId: result.reschedule.id,
      sessionA,
    };
    saveState(state);

    console.log(`\nCreated REAL checkout session A (${sessionA}) for the ₱200.00 difference — deliberately NOT paying it.`);
    console.log(`Re-run this script with "resume" to exercise the abandoned-checkout + stale-session-rejection checks.`);
  } finally {
    await pg.end();
  }
}

async function resume() {
  const state = loadState();
  const { serviceClient, pg, userId } = await getClients();
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    const { rows: originalRows } = await pg.query(`select status from bookings where id = $1`, [state.originalId]);
    record("[Abandoned] original booking is still confirmed, untouched by the unpaid checkout", originalRows[0]?.status === "confirmed", `status=${originalRows[0]?.status}`);

    const { rows: rescheduleRows } = await pg.query(`select status from booking_reschedules where id = $1`, [state.rescheduleId]);
    record("[Abandoned] reschedule is still pending_payment", rescheduleRows[0]?.status === "pending_payment", `status=${rescheduleRows[0]?.status}`);

    console.log("\nCalling the REAL resumeRescheduleCheckout()...");
    const checkoutUrlB = await resumeRescheduleCheckout(serviceClient as never, userId, state.rescheduleId, { siteUrl: "http://localhost:3000" });
    const sessionBMatch = checkoutUrlB.match(/pay\/(cs_test_[a-zA-Z0-9]+)/);
    const sessionB = sessionBMatch ? sessionBMatch[1] : null;
    record("resumeRescheduleCheckout() returned a real new checkout URL", !!sessionB, `checkoutUrlB=${checkoutUrlB}`);

    const { rows: replacementRows } = await pg.query(`select stripe_checkout_session_id from bookings where id = $1`, [state.replacementId]);
    const storedSessionId = replacementRows[0]?.stripe_checkout_session_id;
    record("replacement booking's stored session id was overwritten to the NEW session (not session A)", storedSessionId === sessionB && storedSessionId !== state.sessionA, `stored=${storedSessionId} sessionA=${state.sessionA} sessionB=${sessionB}`);

    console.log(`\nVerifying session A (${state.sessionA}) via Stripe's own API...`);
    const oldSession = await stripe.checkout.sessions.retrieve(state.sessionA);
    record("[B4] Stripe reports the OLD session A as expired (best-effort supersession)", oldSession.status === "expired", `status=${oldSession.status}`);

    console.log(`\nCalling the REAL maybeCompleteReschedule() directly with the STALE session A id (simulating a late/duplicate webhook from the superseded checkout)...`);
    const staleResult = await maybeCompleteReschedule(serviceClient as never, state.replacementId, 20000, "PHP", state.sessionA);
    record("[B4] maybeCompleteReschedule() REJECTS the stale session id (returns false)", staleResult === false, `returned ${staleResult}`);

    const { rows: rescheduleAfterStale } = await pg.query(`select status from booking_reschedules where id = $1`, [state.rescheduleId]);
    record("[B4] reschedule status is unaffected by the rejected stale attempt (still pending_payment)", rescheduleAfterStale[0]?.status === "pending_payment", `status=${rescheduleAfterStale[0]?.status}`);

    state.sessionB = sessionB ?? undefined;
    saveState(state);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;

    console.log(`\nREAL Stripe TEST MODE checkout URL (session B, the CURRENT one) — pay with card 4242 4242 4242 4242, any future expiry, any CVC/ZIP:\n\n  ${checkoutUrlB}\n`);
    console.log(`Once paid, re-run this script with "confirm".`);
  } finally {
    await pg.end();
  }
}

async function confirm() {
  const state = loadState();
  const { serviceClient, pg } = await getClients();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    console.log("Calling the REAL maybeCompleteRescheduleFromProvider() (checks the CURRENT session, B, via Stripe's real API)...");
    const completed = await maybeCompleteRescheduleFromProvider(serviceClient as never, state.replacementId);
    record("maybeCompleteRescheduleFromProvider() completes the reschedule via the current (resumed) session", completed === true, `returned ${completed}`);

    const { rows: rescheduleRows } = await pg.query(`select * from booking_reschedules where id = $1`, [state.rescheduleId]);
    const { rows: originalRows } = await pg.query(`select * from bookings where id = $1`, [state.originalId]);
    const { rows: newRows } = await pg.query(`select * from bookings where id = $1`, [state.replacementId]);
    record("reschedule is now 'completed'", rescheduleRows[0]?.status === "completed", `status=${rescheduleRows[0]?.status}`);
    record("original booking is now cancelled", originalRows[0]?.status === "cancelled", `status=${originalRows[0]?.status}`);
    record("replacement booking is confirmed at its own full price (₱700.00)", newRows[0]?.status === "confirmed" && newRows[0]?.price_amount === 70000, `status=${newRows[0]?.status} price_amount=${newRows[0]?.price_amount}`);

    console.log("\nCalling maybeCompleteRescheduleFromProvider() a SECOND time (duplicate delivery / re-render of the confirmation page)...");
    const secondCall = await maybeCompleteRescheduleFromProvider(serviceClient as never, state.replacementId);
    record("[Idempotency] duplicate completion call safely no-ops (returns false, no re-processing)", secondCall === false, `returned ${secondCall}`);

    console.log("\nCalling maybeCompleteReschedule() directly with session B's correct id (simulating a duplicate webhook delivery)...");
    const thirdCall = await maybeCompleteReschedule(serviceClient as never, state.replacementId, 20000, "PHP", state.sessionB ?? "");
    record("[Idempotency] duplicate webhook-shaped call also safely no-ops (returns false — reschedule no longer pending_payment)", thirdCall === false, `returned ${thirdCall}`);

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
else if (mode === "resume") resume().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "confirm") confirm().catch((e) => { console.error(e); process.exit(1); });
else {
  console.error('Usage: verify-staging-reschedule-checkout-edgecases.ts <create|resume|confirm>');
  process.exit(1);
}
