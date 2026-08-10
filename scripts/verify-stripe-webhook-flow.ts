/**
 * Manual, live proof that Phase 4B's payment/webhook flow actually works
 * against real Stripe and the real database — not just that this
 * codebase's logic is correct for mocked inputs, which the Jest suite
 * (src/lib/services/__tests__/payments.test.ts, the extended
 * bookings.test.ts, checkout.test.ts, and the webhook route.test.ts)
 * already covers.
 *
 * This is deliberately NOT part of `npm test` / CI, same posture as
 * scripts/verify-no-double-booking.ts. There's no Stripe CLI or tunnel
 * (ngrok, etc.) available in this environment, so Stripe's real servers
 * can never deliver a real webhook to a local dev server — the honest
 * substitute this script uses is `stripe.webhooks.generateTestHeaderString`,
 * a Stripe SDK utility built for exactly this: it signs a REAL event
 * payload (fetched from Stripe's own API after a REAL test-card payment)
 * with your real STRIPE_WEBHOOK_SECRET, producing a genuine signature. The
 * webhook route handler (src/app/api/stripe/webhook/route.ts) then runs
 * completely unmodified — real signature verification, real
 * confirm_booking_payment() RPC call, real database write. The only thing
 * not "real" here is how the payload physically arrives at the endpoint
 * (a local POST instead of Stripe's own delivery infrastructure); the
 * verification and confirmation logic it exercises is identical either way.
 *
 * WHAT IT DOES, in two steps (run separately, with a manual payment
 * step in between — see "HOW TO RUN" below):
 *
 *   `create` step:
 *     1. Signs in as a real test user (credentials from environment
 *        variables only — never hardcoded, never asked for in chat).
 *     2. Looks up a real available slot on a target demo court, via the
 *        same get_available_slots RPC the app itself uses.
 *     3. Creates a REAL pending booking (status: "pending") — the same
 *        createBooking()-shaped insert lib/actions/checkout.ts makes.
 *     4. Creates a REAL Stripe test-mode Checkout Session for that
 *        booking's own stored price/currency, via the real Stripe API.
 *     5. Attaches the session id to the booking (self-service update,
 *        same as attachCheckoutSession()).
 *     6. Prints the booking id and the Checkout Session's real
 *        stripe.com URL — open it in a browser and pay with Stripe's
 *        official test card (4242 4242 4242 4242, any future expiry,
 *        any 3-digit CVC, any ZIP). This is Stripe's own published test
 *        card for exactly this purpose — no real money moves in test mode.
 *
 *   `confirm` step (after completing the test payment above):
 *     7. Fetches the booking, then re-fetches its Checkout Session from
 *        Stripe's real API — confirming `payment_status: "paid"`.
 *     8. Builds the exact `checkout.session.completed` event payload the
 *        webhook route expects, signs it with generateTestHeaderString
 *        using your real STRIPE_WEBHOOK_SECRET.
 *     9. POSTs it to the local webhook endpoint (WEBHOOK_URL, defaults to
 *        http://localhost:3000/api/stripe/webhook) — the real route
 *        handler runs, verifies the real signature, calls the real
 *        confirm_booking_payment() RPC.
 *    10. Re-fetches the booking and asserts status is now "confirmed",
 *        with stripe_payment_intent_id/paid_at set.
 *    11. POSTs the IDENTICAL signed payload a second time — proves
 *        idempotency: the RPC's `where status = 'pending'` guard means
 *        this finds the booking already confirmed and safely no-ops
 *        (confirmed: false in the response), not an error, not a
 *        second write.
 *    12. Cancels the test booking afterward so it doesn't linger as a
 *        real reservation. The row is NOT deleted — bookings have no
 *        delete RLS policy anywhere in this schema, by design; a
 *        cancelled real booking is the correct, honest cleanup state,
 *        same as scripts/verify-no-double-booking.ts already established.
 *
 * HOW TO RUN:
 *   The dev server must be running locally first: `npm run dev`.
 *
 *   Set these environment variables (this script does NOT read
 *   .env.local automatically, so you know exactly what it has access to):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *     BOOKING_TEST_EMAIL
 *     BOOKING_TEST_PASSWORD
 *     STRIPE_SECRET_KEY        (test-mode, sk_test_...)
 *     STRIPE_WEBHOOK_SECRET    (whsec_..., matching whatever endpoint you
 *                               created to generate one — see README.md)
 *   Optional:
 *     BOOKING_TEST_COURT_ID  (defaults to the seeded [DEMO] Banilad Pickle
 *                             Club's Court 1)
 *     WEBHOOK_URL             (defaults to http://localhost:3000/api/stripe/webhook)
 *
 *   Then:
 *     npx ts-node scripts/verify-stripe-webhook-flow.ts create
 *     # ... open the printed URL, pay with the test card ...
 *     npx ts-node scripts/verify-stripe-webhook-flow.ts confirm --booking-id=<id from step above>
 *
 *   None of this happens automatically — you run it, you read the result.
 */
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const DEFAULT_TEST_COURT_ID = "00000000-0000-4000-8001-000000000001"; // [DEMO] Banilad Pickle Club, Court 1
const DEFAULT_WEBHOOK_URL = "http://localhost:3000/api/stripe/webhook";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("See the header comment in this file for the full list and how to run this script.");
    process.exit(1);
  }
  return value;
}

function getSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    process.exit(1);
  }
  return createClient(url, key);
}

async function signIn(supabase: ReturnType<typeof getSupabase>) {
  const email = requireEnv("BOOKING_TEST_EMAIL");
  const password = requireEnv("BOOKING_TEST_PASSWORD");
  console.log(`Signing in as ${email}...`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    console.error("Sign-in failed:", error?.message);
    process.exit(1);
  }
  console.log(`Signed in as user ${data.user.id}.`);
  return data.user.id;
}

async function runCreate() {
  const supabase = getSupabase();
  const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeSecretKey);
  const courtId = process.env.BOOKING_TEST_COURT_ID || DEFAULT_TEST_COURT_ID;

  const userId = await signIn(supabase);

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
    console.error(`No available slots found for ${localDate}. Has supabase/seed.sql been run? Or try a different BOOKING_TEST_COURT_ID.`);
    process.exit(1);
  }
  const target = slots[0] as { slot_start: string; slot_end: string };
  console.log(`Using slot ${target.slot_start} - ${target.slot_end}.`);

  const { data: court, error: courtError } = await supabase.from("courts").select("hourly_price, name, venue_id").eq("id", courtId).single();
  if (courtError || !court) {
    console.error("Couldn't load the court's price:", courtError?.message);
    process.exit(1);
  }
  const durationHours = (new Date(target.slot_end).getTime() - new Date(target.slot_start).getTime()) / 3_600_000;
  const priceAmount = Math.round(Number(court.hourly_price) * 100 * durationHours);

  console.log(`Creating a real PENDING booking (price_amount=${priceAmount}, currency=PHP)...`);
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      court_id: courtId,
      user_id: userId,
      start_time: target.slot_start,
      end_time: target.slot_end,
      status: "pending",
      price_amount: priceAmount,
      currency: "PHP",
    })
    .select("*")
    .single();
  if (bookingError || !booking) {
    console.error("Booking insert failed:", bookingError?.message);
    process.exit(1);
  }
  console.log(`Created pending booking ${booking.id}.`);

  console.log("Creating a real Stripe test-mode Checkout Session...");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "php",
          unit_amount: priceAmount,
          product_data: { name: `${court.name} — verify-stripe-webhook-flow` },
        },
      },
    ],
    metadata: { booking_id: booking.id, user_id: userId },
    success_url: "https://example.com/success",
    cancel_url: "https://example.com/cancel",
  });
  if (!session.url) {
    console.error("Stripe didn't return a session URL.");
    process.exit(1);
  }

  const { error: attachError } = await supabase.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", booking.id);
  if (attachError) {
    console.error("Failed to attach session id to the booking:", attachError.message);
    process.exit(1);
  }

  console.log("\n--- Next step ---");
  console.log(`BOOKING_ID=${booking.id}`);
  console.log(`CHECKOUT_URL=${session.url}`);
  console.log("\nOpen the URL above and pay with Stripe's test card: 4242 4242 4242 4242, any future expiry, any CVC, any ZIP.");
  console.log(`Then run: npx ts-node scripts/verify-stripe-webhook-flow.ts confirm --booking-id=${booking.id}`);
}

async function runConfirm() {
  const bookingIdArg = process.argv.find((a) => a.startsWith("--booking-id="));
  const bookingId = bookingIdArg?.split("=")[1];
  if (!bookingId) {
    console.error("Usage: npx ts-node scripts/verify-stripe-webhook-flow.ts confirm --booking-id=<id>");
    process.exit(1);
  }

  const supabase = getSupabase();
  const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
  const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
  const webhookUrl = process.env.WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
  const stripe = new Stripe(stripeSecretKey);

  await signIn(supabase);

  const { data: booking, error: bookingError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingError || !booking) {
    console.error("Couldn't load the booking:", bookingError?.message);
    process.exit(1);
  }
  if (!booking.stripe_checkout_session_id) {
    console.error("This booking has no stripe_checkout_session_id — did the create step run?");
    process.exit(1);
  }

  console.log(`Fetching the real Checkout Session ${booking.stripe_checkout_session_id} from Stripe...`);
  const session = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
  console.log(`payment_status: ${session.payment_status}`);
  if (session.payment_status !== "paid") {
    console.error("Stripe reports this session isn't paid yet. Complete the test-card payment first (see the create step's printed URL).");
    process.exit(1);
  }
  if (typeof session.payment_intent !== "string" || session.amount_total == null) {
    console.error("Session is missing payment_intent/amount_total — unexpected.");
    process.exit(1);
  }

  const event = {
    id: `evt_verify_${Date.now()}`,
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: { object: session },
  };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

  console.log(`\nPOSTing the real, signed event to ${webhookUrl} (first delivery)...`);
  const firstResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  const firstJson = await firstResponse.json();
  console.log(`Response: ${firstResponse.status}`, firstJson);

  const { data: confirmedBooking, error: refetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (refetchError || !confirmedBooking) {
    console.error("Couldn't re-fetch the booking:", refetchError?.message);
    process.exit(1);
  }
  console.log(`\nBooking status after first delivery: ${confirmedBooking.status}`);
  console.log(`stripe_payment_intent_id: ${confirmedBooking.stripe_payment_intent_id}`);
  console.log(`paid_at: ${confirmedBooking.paid_at}`);

  const firstDeliveryPass =
    firstResponse.status === 200 && confirmedBooking.status === "confirmed" && confirmedBooking.stripe_payment_intent_id === session.payment_intent;

  console.log(`\nPOSTing the IDENTICAL signed event a second time (idempotency proof)...`);
  const secondResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  const secondJson = await secondResponse.json();
  console.log(`Response: ${secondResponse.status}`, secondJson);

  const { data: afterSecondBooking } = await supabase.from("bookings").select("status, paid_at").eq("id", bookingId).single();
  const idempotencyPass =
    secondResponse.status === 200 &&
    (secondJson as { confirmed?: boolean }).confirmed === false &&
    afterSecondBooking?.status === "confirmed" &&
    afterSecondBooking?.paid_at === confirmedBooking.paid_at;

  console.log(`\nCancelling the test booking (${bookingId}) so it doesn't linger as a real reservation...`);
  const { error: cancelError } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
  if (cancelError) {
    console.error("Cleanup cancel failed (not fatal to the test result):", cancelError.message);
  } else {
    console.log("Cancelled. The row remains (as 'cancelled') — bookings have no delete policy by design.");
  }

  console.log("\n--- Result ---");
  console.log(`First delivery confirmed the booking correctly: ${firstDeliveryPass ? "PASS" : "FAIL"}`);
  console.log(`Second (duplicate) delivery safely no-opped: ${idempotencyPass ? "PASS" : "FAIL"}`);
  const pass = firstDeliveryPass && idempotencyPass;
  console.log(`\n${pass ? "PASS" : "FAIL"}: ${pass ? "the real webhook endpoint verified a real Stripe signature, confirmed the booking from real payment data, and was proven idempotent against a duplicate delivery." : "did not see the expected outcome — see details above."}`);
  process.exit(pass ? 0 : 1);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "create") return runCreate();
  if (mode === "confirm") return runConfirm();
  console.error("Usage:");
  console.error("  npx ts-node scripts/verify-stripe-webhook-flow.ts create");
  console.error("  npx ts-node scripts/verify-stripe-webhook-flow.ts confirm --booking-id=<id>");
  process.exit(1);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
