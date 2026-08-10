import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { constructPayMongoWebhookEvent, PayMongoError } from "@/lib/services/paymongo";
import { confirmPaymongoBookingPayment } from "@/lib/services/bookings";
import { logServerError } from "@/lib/errors";

/**
 * The PayMongo webhook endpoint — a separate route, separate secret, and
 * separate confirmation RPC from src/app/api/stripe/webhook/route.ts,
 * deliberately (see ARCHITECTURE.md's PayMongo TEST MODE section for why
 * this project chose duplication over touching the already-live Stripe
 * webhook). Same authority model as the Stripe route: this endpoint —
 * never the browser's post-checkout redirect — is what's allowed to mark
 * a booking paid.
 *
 * `checkout_session.payment.paid` is the one event this handler acts on
 * (PayMongo's direct analogue of Stripe's `checkout.session.completed`).
 * Every other event type is acknowledged with 200 and ignored — PayMongo,
 * like Stripe, retries on non-2xx responses.
 *
 * Idempotent by construction, not by tracking "have I seen this event id
 * before": confirmPaymongoBookingPayment() (confirm_paymongo_booking_payment()
 * in Postgres) only transitions a booking whose status is still 'pending',
 * mirroring confirm_booking_payment()'s exact mechanism.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("paymongo-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes PayMongo sent — this
  // must happen before any JSON parsing, same discipline as the Stripe route.
  const rawBody = await request.text();

  let event: ReturnType<typeof constructPayMongoWebhookEvent>;
  try {
    event = constructPayMongoWebhookEvent(rawBody, signature);
  } catch (error) {
    logServerError("paymongo.webhook.invalidSignature", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.data.attributes.type !== "checkout_session.payment.paid") {
    return NextResponse.json({ received: true, ignored: event.data.attributes.type });
  }

  const checkoutSession = event.data.attributes.data;
  const bookingId = checkoutSession.attributes.metadata?.booking_id;
  const paymentIntent = checkoutSession.attributes.payment_intent;
  const paidPayment = paymentIntent?.attributes.payments.find((p) => p.attributes.status === "paid");

  if (!bookingId || !paymentIntent || !paidPayment) {
    logServerError(
      "paymongo.webhook.malformedSession",
      new Error(`checkout session ${checkoutSession.id} missing booking_id/payment_intent/a paid payment`)
    );
    // Acknowledge anyway — retrying won't fix a session that was never
    // created with the right metadata, same posture as the Stripe route.
    return NextResponse.json({ received: true, error: "malformed session" });
  }

  try {
    const supabase = await createClient();
    const confirmed = await confirmPaymongoBookingPayment(supabase, {
      bookingId,
      paymongoCheckoutSessionId: checkoutSession.id,
      paymongoPaymentIntentId: paymentIntent.id,
      expectedAmount: paidPayment.attributes.amount,
      expectedCurrency: paidPayment.attributes.currency.toUpperCase(),
    });

    if (!confirmed) {
      // Not an error — either already confirmed (duplicate delivery,
      // expected and fine) or a genuine session/amount mismatch (worth a
      // server-side log to investigate, never a reason to make PayMongo
      // retry indefinitely).
      logServerError(
        "paymongo.webhook.confirmNoOp",
        new Error(`booking ${bookingId} / session ${checkoutSession.id} did not transition`)
      );
    }

    return NextResponse.json({ received: true, confirmed });
  } catch (error) {
    if (error instanceof PayMongoError) {
      logServerError(`paymongo.webhook.${error.reason}`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    logServerError("paymongo.webhook.confirmFailed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
