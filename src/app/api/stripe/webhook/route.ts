import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { constructWebhookEvent, PaymentError } from "@/lib/services/payments";
import { confirmBookingPayment } from "@/lib/services/bookings";
import { maybeCompleteReschedule } from "@/lib/services/reschedules";
import { logServerError } from "@/lib/errors";

/**
 * The Stripe webhook endpoint — the actual authority for "was this
 * booking paid for," never the browser redirect back from Checkout (see
 * ARCHITECTURE.md's Phase 4B section). `checkout.session.completed` is
 * the one event this handler acts on: it's Stripe's own recommended
 * top-level signal for a finished Checkout, and it carries the
 * `metadata.booking_id` set at session-creation time (lib/services/payments.ts),
 * so no second lookup is needed to find which booking it's for. Every
 * other event type this endpoint receives is acknowledged with 200 and
 * ignored — Stripe retries on anything other than a 2xx, so an endpoint
 * that only cares about one event type must still ack the rest.
 *
 * Idempotent by construction, not by tracking "have I seen this event
 * id before": confirmBookingPayment() (confirm_booking_payment() in
 * Postgres) only transitions a booking whose status is still 'pending',
 * so a duplicate delivery of the same event finds it already 'confirmed'
 * and safely no-ops. See supabase/migrations/20260810000007_booking_payments.sql.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes Stripe sent — this
  // must happen before any JSON parsing, and request.text() (not
  // request.json()) is what preserves that.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (error) {
    logServerError("stripe.webhook.invalidSignature", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const bookingId = session.metadata?.booking_id;

  if (!bookingId || typeof session.payment_intent !== "string" || session.amount_total == null) {
    logServerError("stripe.webhook.malformedSession", new Error(`session ${session.id} missing booking_id/payment_intent/amount_total`));
    // Acknowledge anyway — retrying won't fix a session that was never
    // created with the right metadata, and returning non-2xx just makes
    // Stripe retry forever.
    return NextResponse.json({ received: true, error: "malformed session" });
  }

  try {
    const supabase = await createClient();
    const confirmed = await confirmBookingPayment(supabase, {
      bookingId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.payment_intent,
      expectedAmount: session.amount_total,
      expectedCurrency: (session.currency ?? "php").toUpperCase(),
    });

    if (!confirmed) {
      // Not an error — either already confirmed (duplicate delivery,
      // expected and fine) or a genuine session/amount mismatch (worth a
      // server-side log to investigate, but never a reason to make Stripe
      // retry indefinitely).
      logServerError("stripe.webhook.confirmNoOp", new Error(`booking ${bookingId} / session ${session.id} did not transition`));
    }

    // Additive: a reschedule's price-increase difference checkout charges
    // less than the replacement booking's own price_amount, so
    // confirmBookingPayment() above always no-ops for it (by design — see
    // lib/services/reschedules.ts). This is the actual confirmation path
    // for that case; for every normal (non-reschedule) booking it's a
    // cheap, harmless no-op (no booking_reschedules row references it).
    const rescheduleCompleted = await maybeCompleteReschedule(
      supabase,
      bookingId,
      session.amount_total,
      session.currency ?? "php",
      session.id
    );

    return NextResponse.json({ received: true, confirmed, rescheduleCompleted });
  } catch (error) {
    if (error instanceof PaymentError) {
      logServerError(`stripe.webhook.${error.reason}`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    logServerError("stripe.webhook.confirmFailed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
