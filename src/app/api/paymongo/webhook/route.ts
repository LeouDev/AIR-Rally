import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { constructPayMongoWebhookEvent, PayMongoError, type PayMongoMerchantActivationEventData } from "@/lib/services/paymongo";
import { confirmPaymongoBookingPayment, reportUnconfirmedPaymentSafely } from "@/lib/services/bookings";
import { syncVenuePaymongoActivation } from "@/lib/services/venues";
import { maybeCompleteReschedule } from "@/lib/services/reschedules";
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

  if (event.data.attributes.type === "merchant.activated" || event.data.attributes.type === "merchant.declined") {
    return handleMerchantActivationEvent(event.data.attributes.data as unknown as PayMongoMerchantActivationEventData);
  }

  if (event.data.attributes.type !== "checkout_session.payment.paid") {
    return NextResponse.json({ received: true, ignored: event.data.attributes.type });
  }

  const checkoutSession = event.data.attributes.data;
  const bookingId = checkoutSession.attributes.metadata?.booking_id;
  const paymentIntent = checkoutSession.attributes.payment_intent;
  // PayMongo's docs confirm a PaymentIntent can carry more than one
  // Payment (one per attempt — a declined card followed by a successful
  // retry produces two). That "at most one ever reaches status 'paid'"
  // is NOT a documented guarantee, though — it's inferred from the
  // PaymentIntent status machine (four states, no separate "failed";
  // succeeded reads as terminal, a failed attempt bounces back to
  // awaiting_payment_method rather than the intent double-succeeding).
  // `.find()` below silently trusts that inference: if it's ever wrong,
  // this picks one paid Payment and nobody would know. Detect it rather
  // than trust it — logged critical (real alert, not just console.error)
  // if it ever fires, but never blocks confirmation over it: a customer
  // who actually paid should not see their booking fail because our
  // selection logic became uncertain.
  const paidPayments = paymentIntent?.attributes.payments.filter((p) => p.attributes.status === "paid") ?? [];
  if (paidPayments.length > 1) {
    logServerError(
      "paymongo.webhook.multiplePaidPayments",
      new Error(
        `PaymentIntent ${paymentIntent?.id} has ${paidPayments.length} Payments with status "paid" — ` +
          `expected at most one. Picking payments[0] (${paidPayments[0].id}); the others are ` +
          `${paidPayments.slice(1).map((p) => p.id).join(", ")}. This means the "at most one paid Payment" ` +
          `assumption in requestRefund()'s payment-id selection may be wrong — investigate before trusting ` +
          `a refund against this checkout session.`
      ),
      { critical: true }
    );
  }
  const paidPayment = paidPayments[0];

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
    // Service role, not the request-scoped client: since migration
    // 20260810000047 confirm_paymongo_booking_payment() is granted to
    // service_role only. A webhook carries no user session anyway, so the
    // old createClient() here was acting as `anon` — which is precisely
    // the grant that made the RPC a free-booking exploit from a browser.
    // The authority for this call is the verified webhook signature above.
    const supabase = createServiceRoleClient();
    const confirmed = await confirmPaymongoBookingPayment(supabase, {
      bookingId,
      paymongoCheckoutSessionId: checkoutSession.id,
      paymongoPaymentIntentId: paymentIntent.id,
      expectedAmount: paidPayment.attributes.amount,
      expectedCurrency: paidPayment.attributes.currency.toUpperCase(),
    });

    // Additive: a reschedule's price-increase difference checkout charges
    // less than the replacement booking's own price_amount, so
    // confirmPaymongoBookingPayment() above always no-ops for it (by
    // design — see lib/services/reschedules.ts). This is the actual
    // confirmation path for that case; for every normal (non-reschedule)
    // booking it's a cheap, harmless no-op.
    const rescheduleCompleted = await maybeCompleteReschedule(
      supabase,
      bookingId,
      paidPayment.attributes.amount,
      paidPayment.attributes.currency,
      checkoutSession.id
    );

    // Diagnosed only after BOTH confirmation paths have had their turn.
    // Doing it immediately after confirmPaymongoBookingPayment() would
    // fire on every price-increase reschedule, which no-ops there by
    // design — that noise is what made the old confirmNoOp line useless.
    //
    // A mismatch surviving both paths means PayMongo took money for a
    // booking that will not confirm. It is logged loudly, with both
    // amounts, because the customer is already on a pending screen.
    if (!confirmed && !rescheduleCompleted) {
      // Belt and braces: reportUnconfirmedPaymentSafely() already swallows
      // its own failures, but this route must not depend on another
      // module's promise never rejecting. An exception escaping here would
      // reach the outer catch and return 500, which makes PayMongo retry
      // the delivery indefinitely and buries the log line this exists to
      // surface. A diagnostic must never change the response.
      try {
        await reportUnconfirmedPaymentSafely(supabase, "paymongo.webhook", {
          bookingId,
          paidAmount: paidPayment.attributes.amount,
          paidCurrency: paidPayment.attributes.currency,
          checkoutSessionId: checkoutSession.id,
        });
      } catch (diagnosticError) {
        logServerError("paymongo.webhook.diagnosisFailed", diagnosticError);
      }
    }

    // Still a 200 regardless: PayMongo retrying cannot fix a mismatch, and
    // an endless retry storm would bury the log line above.
    return NextResponse.json({ received: true, confirmed, rescheduleCompleted });
  } catch (error) {
    if (error instanceof PayMongoError) {
      logServerError(`paymongo.webhook.${error.reason}`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    logServerError("paymongo.webhook.confirmFailed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Handles the PayMongo Platforms onboarding "reliable signal" events (see
 * ARCHITECTURE.md's PayMongo Platforms section for why the synchronous
 * activate-call response is deliberately NOT trusted for this instead).
 * Looked up purely by merchant_id via sync_venue_paymongo_activation() — a
 * stray event matching no venue is a safe no-op, same idempotent posture
 * as the checkout-session handler above.
 */
async function handleMerchantActivationEvent(data: PayMongoMerchantActivationEventData): Promise<Response> {
  const activationStatus = data.activation_status === "activated" ? "activated" : "declined";

  try {
    // Service role, for the same reason as the confirmation handler above:
    // sync_venue_paymongo_activation() is granted to service_role only since
    // migration 20260810000048, because it raises the bypass GUC that stops
    // owners writing their own activation status. The authority for this
    // call is the verified webhook signature.
    const supabase = createServiceRoleClient();
    const synced = await syncVenuePaymongoActivation(supabase, {
      paymongoAccountId: data.merchant_id,
      activationStatus,
      declinedReason: data.declined_message ?? null,
    });

    if (!synced) {
      logServerError(
        "paymongo.webhook.activationNoMatchingVenue",
        new Error(`merchant.${activationStatus} for account ${data.merchant_id} matched no venue`),
        { critical: true }
      );
    }

    return NextResponse.json({ received: true, synced });
  } catch (error) {
    logServerError("paymongo.webhook.activationSyncFailed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
