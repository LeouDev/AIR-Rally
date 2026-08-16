/**
 * THE critical re-verification for the production-readiness audit's
 * "Blocker A": every prior staging script called createReschedule() with
 * a SERVICE-ROLE client, which bypasses RLS entirely — silently walking
 * around the exact trust boundary a real customer session hits in
 * production (createRescheduleAction -> getServerClient(), an ordinary
 * authenticated, non-admin session). This script uses that same
 * ordinary customer-session client (authClient, signed in via
 * auth.signInWithPassword — a real JWT with a real, non-admin
 * auth.uid(), functionally identical to production's SSR session for
 * RLS purposes) as the ENTRY-POINT client passed into createReschedule()
 * itself, for the price-decrease branch specifically.
 *
 * Before the fix: requestRefund()'s booking_refunds insert would run
 * under this same customer client and get rejected with a real Postgres
 * 42501 (booking_refunds' INSERT policy is admin-only), and — because
 * that raw error isn't a RefundError — the cleanup path would never run,
 * leaving the replacement booking and the reschedule row stuck.
 *
 * After the fix: requestRefund() is called from inside reschedules.ts
 * using ITS OWN internal service-role client (never exposed to this
 * script, never exposed to the customer) — so from this script's
 * perspective as an ordinary customer, the whole decrease reschedule
 * should just work end to end, exactly as it does for increase/same-price.
 *
 * Two independent scenarios:
 *
 *   create / confirm-original / reschedule — the happy path: a real
 *     Stripe TEST MODE payment on the original, then a real decrease
 *     reschedule initiated via the customer's own session, proving the
 *     refund completes, is recorded correctly, and the reschedule/
 *     booking state all transition correctly — all while the ENTRY
 *     client for createReschedule() is the customer's own.
 *
 *   refund-failure — the negative path: simulates "a refund is already
 *     in progress" (a real 23505 from booking_refunds_one_pending_per_
 *     booking, mapped to RefundError("refund_already_in_progress", ...))
 *     by pre-inserting a genuine 'pending' booking_refunds row via the
 *     service-role client (standing in for a conflicting concurrent
 *     attempt), then calling createReschedule() via the customer's own
 *     session and proving the EXISTING cleanup path still fires
 *     correctly: the reschedule reaches 'failed' and the replacement
 *     booking is cancelled — never left stuck.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","baseUrl":".","paths":{"@/*":["./src/*"]}}' \
 *     node -r tsconfig-paths/register -r ts-node/register scripts/verify-staging-reschedule-decrease-customer-session.ts create
 *   ... open the printed URL, pay with Stripe's test card ...
 *   ... same invocation with "confirm-original" ...
 *   ... same invocation with "reschedule" ...
 *   ... separately, any time: same invocation with "refund-failure" ...
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

const STATE_FILE = path.join(__dirname, ".staging-reschedule-decrease-customer-session-state.json");

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
  // authClient: an ORDINARY, non-admin, authenticated customer session —
  // the exact client type this whole script exists to exercise as the
  // entry point into createReschedule(). Never elevated, never given the
  // secret key.
  const authClient = createClient(url, anonKey);
  // serviceClient: used ONLY for test-fixture setup (venue/court rows,
  // pg access) that has nothing to do with the trust boundary under
  // test — never passed into createReschedule() in this script.
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

async function cleanup(pg: PgClient, state: State) {
  console.log("\nCleaning up staging test data...");
  if (state.rescheduleId) await pg.query(`delete from booking_reschedules where id = $1`, [state.rescheduleId]).catch((e) => console.error(e.message));
  await pg.query(`delete from booking_refunds where booking_id = $1`, [state.originalId]).catch((e) => console.error(e.message));
  await pg.query(`delete from bookings where id = any($1::uuid[])`, [[state.originalId, state.replacementId].filter(Boolean)]).catch((e) => console.error(e.message));
  await pg.query(`delete from venue_operating_hours where venue_id = $1`, [state.venueId]).catch((e) => console.error(e.message));
  await pg.query(`delete from courts where id = any($1::uuid[])`, [[state.courtAId, state.courtBId]]).catch((e) => console.error(e.message));
  await pg.query(`delete from venues where id = $1`, [state.venueId]).catch((e) => console.error(e.message));
  console.log("Cleanup done.");
}

async function create() {
  const { serviceClient, pg, userId } = await getClients();
  try {
    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Decrease (Customer Session)", status: "active", indoor_outdoor: "outdoor" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    const venueId = venueInsert.data.id;

    const courtA = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court A (₱700/hr)", hourly_price: 700, status: "active" }).select("*").single();
    if (courtA.error) throw courtA.error;
    const courtB = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court B (₱500/hr)", hourly_price: 500, status: "active" }).select("*").single();
    if (courtB.error) throw courtB.error;
    const courtAId = courtA.data.id;
    const courtBId = courtB.data.id;

    await serviceClient.from("venue_operating_hours").insert(Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId, day_of_week: day, start_time: "00:00", end_time: "23:30" })));

    const original = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtAId,
        user_id: userId,
        start_time: daysFromNow(18, 8),
        end_time: daysFromNow(18, 9),
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
      venueName: "[STAGING-TEST] Decrease (Customer Session)",
      courtName: "[STAGING-TEST] Court A (₱700/hr)",
      successUrl: "http://localhost:3000/bookings/success",
      cancelUrl: "http://localhost:3000/bookings/cancel",
    });
    if (!session.url) throw new Error("Stripe did not return a session URL.");

    // Attaching via serviceClient here is fine — createCheckoutSessionAction
    // does this step with the customer's own session in production too,
    // but it's not part of the trust boundary this script exists to test
    // (booking updates for self-owned pending bookings are already
    // customer-writable RLS, unrelated to booking_refunds).
    await attachCheckoutSession(serviceClient as never, original.data.id, session.id);

    const state: State = { venueId, courtAId, courtBId, originalId: original.data.id };
    saveState(state);

    console.log(`\nREAL Stripe TEST MODE checkout URL for the ORIGINAL ₱700.00 booking — open this and pay with card 4242 4242 4242 4242, any future expiry, any CVC/ZIP:\n\n  ${session.url}\n`);
    console.log(`Once paid, re-run this script with "confirm-original".`);
  } finally {
    await pg.end();
  }
}

async function confirmOriginal() {
  const state = loadState();
  const { authClient, pg } = await getClients();
  try {
    const { data: before } = await authClient.from("bookings").select("stripe_checkout_session_id").eq("id", state.originalId).single();
    const sessionId = before?.stripe_checkout_session_id;
    if (!sessionId) throw new Error("Original booking has no stripe_checkout_session_id — did the create step run?");

    // The customer's own session client — matches the real confirmation
    // page exactly (see src/app/(marketing)/bookings/[bookingId]/confirmation/page.tsx).
    console.log("Calling the REAL reconcilePendingBooking() fallback via the CUSTOMER's own session...");
    const reconciled = await reconcilePendingBooking(authClient as never, state.originalId, sessionId);
    console.log(`Original booking status after reconciliation: ${reconciled.status}`);
    console.log(`stripe_payment_intent_id: ${reconciled.stripe_payment_intent_id}`);

    if (reconciled.status !== "confirmed" || !reconciled.stripe_payment_intent_id) {
      console.error("Original booking is not confirmed yet — pay via the checkout URL from the create step, then re-run confirm-original.");
      process.exit(1);
    }
    console.log("\nPASS — original booking confirmed with a REAL stripe_payment_intent_id, via the customer's own session.");
    console.log(`Now re-run this script with "reschedule".`);
  } finally {
    await pg.end();
  }
}

async function reschedule() {
  const state = loadState();
  const { authClient, pg, userId } = await getClients();
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  try {
    const { rows: originalRows } = await pg.query(`select * from bookings where id = $1`, [state.originalId]);
    const originalBefore = originalRows[0];
    record("[setup] original booking is confirmed before rescheduling", originalBefore?.status === "confirmed", `status=${originalBefore?.status}`);
    record("[setup] original booking has a real stripe_payment_intent_id", !!originalBefore?.stripe_payment_intent_id && !originalBefore.stripe_payment_intent_id.startsWith("pi_staging_test_"), `stripe_payment_intent_id=${originalBefore?.stripe_payment_intent_id}`);

    console.log("\n[1] Calling the REAL createReschedule() with the CUSTOMER's own RLS-scoped session as the ENTRY-POINT client (exactly what createRescheduleAction passes in production)...");
    let result: Awaited<ReturnType<typeof createReschedule>>;
    let threw: unknown = null;
    try {
      result = await createReschedule(authClient as never, userId, {
        bookingId: state.originalId,
        newCourtId: state.courtBId,
        newStartTime: daysFromNow(18, 11),
        newEndTime: daysFromNow(18, 12),
        siteUrl: "http://localhost:3000",
      });
    } catch (error) {
      threw = error;
      result = undefined as never;
    }

    record(
      "[1] Ordinary customer session: createReschedule() does NOT throw a 42501/RLS error — the pre-fix bug is gone",
      threw === null,
      threw ? `threw: ${threw instanceof Error ? threw.message : String(threw)}` : "no error"
    );
    if (threw !== null) {
      console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
      process.exitCode = 1;
      await cleanup(pg, state);
      return;
    }

    record("[1] createReschedule() (customer session) returns kind='completed'", result.kind === "completed", `kind=${result.kind}`);
    if (result.kind !== "completed") {
      console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
      process.exitCode = 1;
      await cleanup(pg, state);
      return;
    }

    state.replacementId = result.newBooking.id;
    state.rescheduleId = result.reschedule.id;
    saveState(state);

    // [2]+[3] The refund-related DB write succeeded DESPITE the entry
    // client being an ordinary customer session — proving requestRefund()
    // is internally using the service-role client, not the caller's.
    const { rows: refundRows } = await pg.query(`select * from booking_refunds where booking_id = $1 order by created_at desc limit 1`, [state.originalId]);
    const refund = refundRows[0];
    record("[2] booking_refunds row exists (the insert that would 42501 under the pre-fix bug actually succeeded)", !!refund, `refund=${refund?.id}`);
    record("[3] refund amount is exactly ₱200.00 (20000) — the price difference, never the full ₱700", refund?.amount === 20000, `amount=${refund?.amount}`);
    record("[4] booking_refunds status is 'succeeded', refund_basis 'gross_only', linked to the original's real payment_intent", refund?.status === "succeeded" && refund?.refund_basis === "gross_only" && refund?.provider_payment_id === originalBefore.stripe_payment_intent_id, `status=${refund?.status} refund_basis=${refund?.refund_basis} provider_payment_id=${refund?.provider_payment_id}`);

    if (refund?.provider_refund_id) {
      const stripeRefund = await stripe.refunds.retrieve(refund.provider_refund_id);
      record("[3b] Stripe's own API independently confirms the refund: succeeded, amount 20000", stripeRefund.status === "succeeded" && stripeRefund.amount === 20000, `stripe status=${stripeRefund.status} amount=${stripeRefund.amount}`);
    }

    const { rows: rescheduleRows } = await pg.query(`select * from booking_reschedules where id = $1`, [state.rescheduleId]);
    const { rows: originalAfterRows } = await pg.query(`select * from bookings where id = $1`, [state.originalId]);
    const { rows: replacementRows } = await pg.query(`select * from bookings where id = $1`, [state.replacementId]);

    record("[5] reschedule reaches 'completed'", rescheduleRows[0]?.status === "completed", `status=${rescheduleRows[0]?.status}`);
    record("[6] replacement reaches 'confirmed' at its own full price (₱500.00)", replacementRows[0]?.status === "confirmed" && replacementRows[0]?.price_amount === 50000, `status=${replacementRows[0]?.status} price_amount=${replacementRows[0]?.price_amount}`);
    record("[7] original reaches 'cancelled'", originalAfterRows[0]?.status === "cancelled", `status=${originalAfterRows[0]?.status}`);
    record(
      "[8] original's financial fields are unchanged (price_amount/currency/stripe_payment_intent_id identical to before)",
      originalAfterRows[0]?.price_amount === originalBefore.price_amount &&
        originalAfterRows[0]?.currency === originalBefore.currency &&
        originalAfterRows[0]?.stripe_payment_intent_id === originalBefore.stripe_payment_intent_id,
      `price_amount=${originalAfterRows[0]?.price_amount} currency=${originalAfterRows[0]?.currency} stripe_payment_intent_id=${originalAfterRows[0]?.stripe_payment_intent_id}`
    );

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;

    await cleanup(pg, state);
  } finally {
    await pg.end();
  }
}

async function refundFailure() {
  const { authClient, serviceClient, pg, userId } = await getClients();
  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  let state: State | null = null;
  try {
    const venueInsert = await serviceClient
      .from("venues")
      .insert({ owner_id: userId, name: "[STAGING-TEST] Decrease Refund-Failure (Customer Session)", status: "active", indoor_outdoor: "outdoor" })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    const venueId = venueInsert.data.id;

    const courtA = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court A (₱700/hr)", hourly_price: 700, status: "active" }).select("*").single();
    if (courtA.error) throw courtA.error;
    const courtB = await serviceClient.from("courts").insert({ venue_id: venueId, name: "[STAGING-TEST] Court B (₱500/hr)", hourly_price: 500, status: "active" }).select("*").single();
    if (courtB.error) throw courtB.error;
    const courtAId = courtA.data.id;
    const courtBId = courtB.data.id;

    await serviceClient.from("venue_operating_hours").insert(Array.from({ length: 7 }, (_, day) => ({ venue_id: venueId, day_of_week: day, start_time: "00:00", end_time: "23:30" })));

    const original = await serviceClient
      .from("bookings")
      .insert({
        court_id: courtAId,
        user_id: userId,
        start_time: daysFromNow(19, 8),
        end_time: daysFromNow(19, 9),
        status: "confirmed",
        price_amount: 70000,
        currency: "PHP",
        payment_provider: "stripe",
        // A fabricated payment_intent is fine for THIS scenario — the
        // refund is expected to fail before any real Stripe call is ever
        // made (it fails at the booking_refunds INSERT stage, due to the
        // pre-existing 'pending' row below), so no real Stripe API call
        // happens in this negative-path test.
        stripe_payment_intent_id: `pi_staging_test_${Date.now()}`,
        paid_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (original.error) throw original.error;
    console.log(`Created confirmed original booking ${original.data.id} on Court A (₱700.00)`);

    state = { venueId, courtAId, courtBId, originalId: original.data.id };

    // Simulate "a refund is already in progress" — a real row genuinely
    // in booking_refunds_one_pending_per_booking's guarded 'pending'
    // state, exactly what a concurrent/racing refund attempt would leave
    // behind. This is what requestRefund()'s insert will collide with
    // (23505 -> RefundError("refund_already_in_progress", ...)).
    const conflictingRefund = await serviceClient
      .from("booking_refunds")
      .insert({
        booking_id: original.data.id,
        payment_provider: "stripe",
        provider_payment_id: original.data.stripe_payment_intent_id,
        amount: 5000,
        currency: "PHP",
        status: "pending",
        initiated_by: userId,
      })
      .select("*")
      .single();
    if (conflictingRefund.error) throw conflictingRefund.error;
    console.log(`Pre-inserted a genuinely 'pending' booking_refunds row ${conflictingRefund.data.id} (simulating a conflicting concurrent refund attempt).`);

    console.log("\nCalling the REAL createReschedule() with the CUSTOMER's own session — expecting a clean RescheduleError('refund_failed'), NOT a raw/unhandled error...");
    let threw: unknown = null;
    try {
      await createReschedule(authClient as never, userId, {
        bookingId: original.data.id,
        newCourtId: courtBId,
        newStartTime: daysFromNow(19, 11),
        newEndTime: daysFromNow(19, 12),
        siteUrl: "http://localhost:3000",
      });
    } catch (error) {
      threw = error;
    }

    record("[9a] createReschedule() throws (the decrease could not complete)", threw !== null, threw ? "threw as expected" : "did NOT throw — unexpected");
    record(
      "[9b] the thrown error is a clean RescheduleError('refund_failed'), not a raw/unhandled Postgres error",
      threw !== null && typeof threw === "object" && threw !== null && "reason" in threw && (threw as { reason: unknown }).reason === "refund_failed",
      threw && typeof threw === "object" ? `reason=${(threw as { reason?: unknown }).reason} message=${(threw as { message?: unknown }).message}` : String(threw)
    );

    // Find the replacement booking createReschedule() created internally
    // before the refund attempt (we don't have its id directly since the
    // call threw) — locate it via booking_reschedules, which the DB
    // insert (customer-permitted) still succeeded for.
    const { rows: rescheduleRows } = await pg.query(
      `select * from booking_reschedules where original_booking_id = $1 order by created_at desc limit 1`,
      [original.data.id]
    );
    const reschedule = rescheduleRows[0];
    record("[9c] a booking_reschedules row exists and reached 'failed' (the existing cleanup path ran)", reschedule?.status === "failed", `status=${reschedule?.status}`);

    if (reschedule) {
      const { rows: replacementRows } = await pg.query(`select status from bookings where id = $1`, [reschedule.new_booking_id]);
      record("[9d] the replacement booking was released (cancelled), never left stuck as 'pending'", replacementRows[0]?.status === "cancelled", `status=${replacementRows[0]?.status}`);
      state.replacementId = reschedule.new_booking_id;
      state.rescheduleId = reschedule.id;
    }

    const { rows: originalAfterRows } = await pg.query(`select status from bookings where id = $1`, [original.data.id]);
    record("[9e] the original booking was never touched (still confirmed, no double-cancellation)", originalAfterRows[0]?.status === "confirmed", `status=${originalAfterRows[0]?.status}`);

    // Clean up the conflicting pending refund row too, so it doesn't
    // trip the unique index for any later run.
    await pg.query(`delete from booking_refunds where id = $1`, [conflictingRefund.data.id]).catch((e) => console.error(e.message));

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (state) await cleanup(pg, state);
    await pg.end();
  }
}

const mode = process.argv[2];
if (mode === "create") create().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "confirm-original") confirmOriginal().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "reschedule") reschedule().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "refund-failure") refundFailure().catch((e) => { console.error(e); process.exit(1); });
else {
  console.error('Usage: verify-staging-reschedule-decrease-customer-session.ts <create|confirm-original|reschedule|refund-failure>');
  process.exit(1);
}
