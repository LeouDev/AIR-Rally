/**
 * Manual, live proof that the experimental PayMongo TEST MODE payment
 * flow actually works against real PayMongo data and the real database —
 * not just that this codebase's logic is correct for mocked inputs, which
 * the Jest suite (src/lib/services/__tests__/paymongo.test.ts, the
 * extended bookings.test.ts/checkout.test.ts, and the webhook
 * route.test.ts) already covers.
 *
 * Deliberately NOT part of `npm test`/CI — same posture as
 * scripts/verify-stripe-webhook-flow.ts, which this script mirrors
 * exactly (two steps, `create` then `confirm`, since a human has to
 * complete the actual payment on PayMongo's hosted page in between). No
 * production PayMongo webhook is registered anywhere for this — instead,
 * a real, completed TEST MODE payment is fetched back from PayMongo's own
 * API and signed locally with `constructPayMongoWebhookEvent`'s real,
 * documented algorithm (see lib/services/paymongo.ts's doc comment) using
 * a `PAYMONGO_WEBHOOK_SECRET` obtained from a placeholder-URL TEST MODE
 * webhook endpoint you create in the PayMongo Dashboard purely to get a
 * real signing secret — the same "locally relayed signed event" technique
 * already established for Stripe in this project, for the same reason
 * (no Stripe CLI/ngrok-equivalent tunnel exists in this environment to
 * receive a real webhook delivery at localhost).
 *
 * WHAT IT DOES, in two steps:
 *
 *   `create` step:
 *     1. Signs in as a real test user (credentials from environment
 *        variables only — never hardcoded, never asked for in chat).
 *     2. Looks up a real available slot on a target demo court.
 *     3. Creates a REAL pending booking with payment_provider="paymongo".
 *     4. Creates a REAL PayMongo test-mode Checkout Session for that
 *        booking's own stored price/currency, via the real PayMongo API.
 *     5. Attaches the session id to the booking.
 *     6. Prints the booking id and the Checkout Session's real
 *        checkout.paymongo.com URL — open it and pay with PayMongo's
 *        official test card (4343 4343 4343 4345, any future expiry, any
 *        3-digit CVC) — the same card already used during this project's
 *        TEST MODE API research pass.
 *
 *   `confirm` step (after completing the test payment above):
 *     7. Fetches the booking, then re-fetches its Checkout Session from
 *        PayMongo's real API — confirming a `paid` payment is present.
 *     8. Builds the checkout_session.payment.paid event payload from that
 *        real data, signs it with the real, documented `t=./te=`
 *        HMAC-SHA256 algorithm using your real PAYMONGO_WEBHOOK_SECRET.
 *     9. POSTs it to the actual, unmodified
 *        src/app/api/paymongo/webhook/route.ts running on a real local
 *        dev server — the real route handler verifies the real signature
 *        and calls the real confirm_paymongo_booking_payment() RPC.
 *    10. Re-fetches the booking and asserts status is now "confirmed",
 *        with paymongo_payment_intent_id/paid_at set.
 *    11. POSTs the IDENTICAL signed payload a second time — proves
 *        idempotency, mirroring the Stripe script's own proof.
 *    12. Cancels the test booking afterward as cleanup (bookings have no
 *        delete policy, by design — "cancelled" is the correct, honest
 *        end state).
 *
 * HOW TO RUN:
 *   The dev server must be running locally first: `npm run dev`.
 *
 *   Set these environment variables (this script does NOT read
 *   .env.local automatically):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *     BOOKING_TEST_EMAIL
 *     BOOKING_TEST_PASSWORD
 *     PAYMONGO_SECRET_KEY        (test-mode, sk_test_...)
 *     PAYMONGO_WEBHOOK_SECRET    (whsec_..., from a placeholder-URL TEST
 *                                 MODE webhook endpoint you create in the
 *                                 PayMongo Dashboard — see README.md)
 *   Optional:
 *     BOOKING_TEST_COURT_ID  (defaults to the seeded [DEMO] Banilad Pickle
 *                             Club's Court 1)
 *     WEBHOOK_URL             (defaults to http://localhost:3000/api/paymongo/webhook)
 *
 *   Then:
 *     npx ts-node scripts/verify-paymongo-checkout-flow.ts create
 *     # ... open the printed URL, pay with the test card ...
 *     npx ts-node scripts/verify-paymongo-checkout-flow.ts confirm --booking-id=<id from step above>
 *
 *   None of this happens automatically — you run it, you read the result.
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const DEFAULT_TEST_COURT_ID = "00000000-0000-4000-8001-000000000001"; // [DEMO] Banilad Pickle Club, Court 1
const DEFAULT_WEBHOOK_URL = "http://localhost:3000/api/paymongo/webhook";
const PAYMONGO_API_BASE = "https://api.paymongo.com/v1";

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

async function paymongoRequest(path: string, secretKey: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${PAYMONGO_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = (await response.json()) as { data?: unknown; errors?: Array<{ detail: string }> };
  if (!response.ok) {
    throw new Error(json.errors?.[0]?.detail ?? `PayMongo API returned ${response.status}`);
  }
  return json.data;
}

async function runCreate() {
  const supabase = getSupabase();
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
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

  console.log(`Creating a real PENDING booking with payment_provider="paymongo" (price_amount=${priceAmount}, currency=PHP)...`);
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
      payment_provider: "paymongo",
    })
    .select("*")
    .single();
  if (bookingError || !booking) {
    console.error("Booking insert failed:", bookingError?.message);
    console.error("If this fails with an unknown-column error, the PayMongo migration (20260810000008_paymongo_provider.sql) hasn't been applied yet.");
    process.exit(1);
  }
  console.log(`Created pending booking ${booking.id}.`);

  console.log("Creating a real PayMongo test-mode Checkout Session...");
  const session = (await paymongoRequest("/checkout_sessions", secretKey, {
    method: "POST",
    body: {
      data: {
        attributes: {
          send_email_receipt: false,
          show_line_items: true,
          line_items: [{ currency: "PHP", amount: priceAmount, name: `${court.name} — verify-paymongo-checkout-flow`, quantity: 1 }],
          payment_method_types: ["card"],
          metadata: { booking_id: booking.id, user_id: userId },
          success_url: "https://example.com/success",
          cancel_url: "https://example.com/cancel",
        },
      },
    },
  })) as { id: string; attributes: { checkout_url: string } };

  const { error: attachError } = await supabase
    .from("bookings")
    .update({ paymongo_checkout_session_id: session.id })
    .eq("id", booking.id);
  if (attachError) {
    console.error("Failed to attach session id to the booking:", attachError.message);
    process.exit(1);
  }

  console.log("\n--- Next step ---");
  console.log(`BOOKING_ID=${booking.id}`);
  console.log(`CHECKOUT_URL=${session.attributes.checkout_url}`);
  console.log("\nOpen the URL above and pay with PayMongo's test card: 4343 4343 4343 4345, any future expiry, any CVC.");
  console.log(`Then run: npx ts-node scripts/verify-paymongo-checkout-flow.ts confirm --booking-id=${booking.id}`);
}

async function runConfirm() {
  const bookingIdArg = process.argv.find((a) => a.startsWith("--booking-id="));
  const bookingId = bookingIdArg?.split("=")[1];
  if (!bookingId) {
    console.error("Usage: npx ts-node scripts/verify-paymongo-checkout-flow.ts confirm --booking-id=<id>");
    process.exit(1);
  }

  const supabase = getSupabase();
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const webhookSecret = requireEnv("PAYMONGO_WEBHOOK_SECRET");
  const webhookUrl = process.env.WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  await signIn(supabase);

  const { data: booking, error: bookingError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingError || !booking) {
    console.error("Couldn't load the booking:", bookingError?.message);
    process.exit(1);
  }
  if (!booking.paymongo_checkout_session_id) {
    console.error("This booking has no paymongo_checkout_session_id — did the create step run?");
    process.exit(1);
  }

  console.log(`Fetching the real Checkout Session ${booking.paymongo_checkout_session_id} from PayMongo...`);
  const session = (await paymongoRequest(`/checkout_sessions/${booking.paymongo_checkout_session_id}`, secretKey)) as {
    id: string;
    type: string;
    attributes: {
      metadata: Record<string, string> | null;
      payment_intent: {
        id: string;
        attributes: { payments: Array<{ id: string; attributes: { amount: number; currency: string; status: string } }> };
      } | null;
    };
  };
  const paidPayment = session.attributes.payment_intent?.attributes.payments.find((p) => p.attributes.status === "paid");
  if (!session.attributes.payment_intent || !paidPayment) {
    console.error("PayMongo reports no paid payment yet. Complete the test-card payment first (see the create step's printed URL).");
    process.exit(1);
  }

  const event = {
    data: {
      id: `evt_verify_${Date.now()}`,
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: session,
      },
    },
  };
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const header = `t=${timestamp},te=${signature},li=`;

  console.log(`\nPOSTing the real, signed event to ${webhookUrl} (first delivery)...`);
  const firstResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "paymongo-signature": header },
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
  console.log(`paymongo_payment_intent_id: ${confirmedBooking.paymongo_payment_intent_id}`);
  console.log(`paid_at: ${confirmedBooking.paid_at}`);

  const firstDeliveryPass =
    firstResponse.status === 200 &&
    confirmedBooking.status === "confirmed" &&
    confirmedBooking.paymongo_payment_intent_id === session.attributes.payment_intent.id;

  console.log(`\nPOSTing the IDENTICAL signed event a second time (idempotency proof)...`);
  const secondResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "paymongo-signature": header },
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
  console.log(
    `\n${pass ? "PASS" : "FAIL"}: ${
      pass
        ? "the real PayMongo webhook endpoint verified a real signature, confirmed the booking from real payment data, and was proven idempotent against a duplicate delivery."
        : "did not see the expected outcome — see details above."
    }`
  );
  process.exit(pass ? 0 : 1);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "create") return runCreate();
  if (mode === "confirm") return runConfirm();
  console.error("Usage:");
  console.error("  npx ts-node scripts/verify-paymongo-checkout-flow.ts create");
  console.error("  npx ts-node scripts/verify-paymongo-checkout-flow.ts confirm --booking-id=<id>");
  process.exit(1);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
