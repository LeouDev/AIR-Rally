import Stripe from "stripe";
import type { Booking } from "@/lib/supabase/types";
import { logServerError } from "@/lib/errors";

export type PaymentErrorReason = "stripe_not_configured" | "checkout_session_creation_failed";

/**
 * Typed domain error for the payment layer, mirroring lib/services/bookings.ts's
 * BookingError — `message` is already user-safe, never a raw Stripe error.
 */
export class PaymentError extends Error {
  constructor(
    public reason: PaymentErrorReason,
    message: string
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new PaymentError(
      "stripe_not_configured",
      "Payments aren't set up yet — add STRIPE_SECRET_KEY to .env.local (see .env.example)."
    );
  }
  // Constructed lazily, once, on first real use — never at module load, so
  // pages that never touch checkout still build/run with no Stripe env
  // vars configured, same posture as getSupabaseEnv().
  stripeClient ??= new Stripe(secretKey);
  return stripeClient;
}

export type CreateCheckoutSessionInput = {
  booking: Booking;
  venueName: string;
  courtName: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
};

/**
 * Creates a real Stripe Checkout Session for an already-created *pending*
 * booking. The caller (lib/actions/checkout.ts) is responsible for having
 * already reserved the interval via createBooking() — this function never
 * creates a booking itself, and the amount/currency it charges always
 * come from the booking's own server-computed price snapshot, never from
 * anything client-supplied. See ARCHITECTURE.md's Phase 4B section for
 * why session.url (redirect-only Checkout) needs no client-side Stripe.js
 * and no publishable key.
 */
export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const { booking, venueName, courtName, successUrl, cancelUrl, customerEmail } = input;

  try {
    return await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: booking.currency.toLowerCase(),
            unit_amount: booking.price_amount,
            product_data: {
              name: `${venueName} — ${courtName}`,
              description: `${new Date(booking.start_time).toISOString()} – ${new Date(booking.end_time).toISOString()}`,
            },
          },
        },
      ],
      // Deliberately minimal — booking_id/user_id only, nothing more
      // personal than necessary (see the Phase 4B brief's own
      // instruction not to put unnecessary personal info in metadata).
      metadata: {
        booking_id: booking.id,
        user_id: booking.user_id,
      },
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  } catch (error) {
    // Logged server-side for diagnostics (Stripe's SDK errors don't carry
    // the secret key itself), never surfaced raw to the user.
    logServerError("payments.createCheckoutSession", error);
    throw new PaymentError(
      "checkout_session_creation_failed",
      "We couldn't start checkout — please try again."
    );
  }
}

/**
 * Fetches a Checkout Session's current state directly from Stripe's API —
 * used by lib/services/bookings.ts#reconcilePendingBooking() (the
 * "confirmation page loads before the webhook lands" fallback) and by
 * scripts/verify-stripe-webhook-flow's live-verification procedure.
 * A real network call, not a cache — this is a genuine check, not a
 * shortcut around the webhook's own authority.
 */
export async function retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(sessionId);
}

/** Verifies a raw webhook payload's Stripe signature and parses it into a typed event — never call this after the body has been parsed/modified. */
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new PaymentError("stripe_not_configured", "Webhook isn't configured.");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}
