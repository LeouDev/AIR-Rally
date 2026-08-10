import crypto from "node:crypto";
import type { Booking } from "@/lib/supabase/types";
import { logServerError } from "@/lib/errors";

const PAYMONGO_API_BASE = "https://api.paymongo.com/v1";

export type PayMongoErrorReason = "paymongo_not_configured" | "checkout_session_creation_failed" | "invalid_webhook_signature";

/** Typed domain error for the PayMongo payment layer, mirroring lib/services/payments.ts's PaymentError shape. */
export class PayMongoError extends Error {
  constructor(
    public reason: PayMongoErrorReason,
    message: string
  ) {
    super(message);
    this.name = "PayMongoError";
  }
}

function getSecretKey(): string {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    throw new PayMongoError(
      "paymongo_not_configured",
      "PayMongo isn't set up yet — add PAYMONGO_SECRET_KEY to .env.local (see .env.example)."
    );
  }
  return secretKey;
}

/**
 * PayMongo's REST API — no official npm SDK is installed for this
 * experimental integration (deliberately: this is a TEST MODE-only, one
 * of two switchable providers, not worth a new dependency for). Auth is
 * HTTP Basic with the secret key as the username and an empty password,
 * exactly as verified against the real API during this project's TEST
 * MODE research pass.
 */
async function paymongoRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const secretKey = getSecretKey();
  const response = await fetch(`${PAYMONGO_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json()) as { data?: T; errors?: Array<{ code: string; detail: string }> };
  if (!response.ok) {
    throw new Error(json.errors?.[0]?.detail ?? `PayMongo API returned ${response.status}`);
  }
  return json.data as T;
}

export type PayMongoCheckoutSession = {
  id: string;
  url: string;
};

export type CreatePayMongoCheckoutSessionInput = {
  booking: Booking;
  venueName: string;
  courtName: string;
  successUrl: string;
  cancelUrl: string;
};

type PayMongoCheckoutSessionResponse = {
  id: string;
  attributes: {
    checkout_url: string;
  };
};

/**
 * Creates a real PayMongo test-mode Checkout Session for an already-created
 * *pending* booking — same ordering/price-integrity discipline as
 * createCheckoutSession() in payments.ts (Stripe): the caller
 * (lib/actions/checkout.ts) has already reserved the interval, and the
 * amount charged always comes from the booking's own server-computed
 * price snapshot, never anything client-supplied.
 */
export async function createPayMongoCheckoutSession(input: CreatePayMongoCheckoutSessionInput): Promise<PayMongoCheckoutSession> {
  const { booking, venueName, courtName, successUrl, cancelUrl } = input;

  try {
    const session = await paymongoRequest<PayMongoCheckoutSessionResponse>("/checkout_sessions", {
      method: "POST",
      body: {
        data: {
          attributes: {
            send_email_receipt: false,
            show_line_items: true,
            line_items: [
              {
                currency: booking.currency,
                amount: booking.price_amount,
                name: `${venueName} — ${courtName}`,
                quantity: 1,
              },
            ],
            payment_method_types: ["card", "gcash", "paymaya", "qrph"],
            metadata: { booking_id: booking.id, user_id: booking.user_id },
            success_url: successUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    });

    if (!session.attributes.checkout_url) {
      throw new Error("PayMongo did not return a checkout_url");
    }
    return { id: session.id, url: session.attributes.checkout_url };
  } catch (error) {
    logServerError("paymongo.createCheckoutSession", error);
    throw new PayMongoError("checkout_session_creation_failed", "We couldn't start checkout — please try again.");
  }
}

type PayMongoPaymentIntentAttributes = {
  amount: number;
  currency: string;
  status: string;
  payments: Array<{ id: string; attributes: { amount: number; currency: string; status: string } }>;
};

export type PayMongoCheckoutSessionDetail = {
  id: string;
  attributes: {
    payment_intent: { id: string; attributes: PayMongoPaymentIntentAttributes } | null;
  };
};

/**
 * The "confirmation page loads before the webhook lands" fallback,
 * mirroring retrieveCheckoutSession() in payments.ts — a real API call
 * (GET by id, confirmed working directly against a real checkout session
 * during this project's TEST MODE research pass), never a cache or a
 * trust-the-URL shortcut. Retrieves the CHECKOUT SESSION rather than a
 * payment intent directly, since the checkout session id is the only
 * PayMongo identifier attached to the booking at pending-creation time —
 * its nested payment_intent carries the actual payment status/amount.
 */
export async function retrievePayMongoCheckoutSession(checkoutSessionId: string): Promise<PayMongoCheckoutSessionDetail> {
  return paymongoRequest<PayMongoCheckoutSessionDetail>(`/checkout_sessions/${checkoutSessionId}`);
}

/**
 * PayMongo's event envelope follows the same JSON:API-style wrapping every
 * other PayMongo resource in this codebase uses (confirmed directly
 * against real Checkout Session/PaymentIntent responses during this
 * project's TEST MODE research pass) — `data.attributes.type` is the real
 * event type (e.g. "checkout_session.payment.paid"), `data.attributes.data`
 * is the affected resource. The exact shape of a real *delivered* webhook
 * event was not independently confirmed (no production webhook was
 * registered, per this integration's explicit scope) — this is inferred
 * from the documented convention and re-verified structurally by the live
 * TEST MODE verification script, not assumed with full confidence.
 */
export type PayMongoEvent = {
  data: {
    id: string;
    type: string;
    attributes: {
      type: string;
      livemode: boolean;
      data: {
        id: string;
        type: string;
        attributes: {
          metadata: Record<string, string> | null;
          payment_intent?: { id: string; attributes: PayMongoPaymentIntentAttributes } | null;
        };
      };
    };
  };
};

/**
 * Verifies a raw webhook payload's signature and parses it into a typed
 * event. Implements PayMongo's real, documented algorithm (confirmed from
 * the official paymongo-node SDK source and a cross-referenced real header
 * example — never guessed): the `Paymongo-Signature` header is three
 * comma-separated `key=value` parts, `t=<unix timestamp>,te=<test-mode
 * HMAC>,li=<live-mode HMAC>`. The signed string is `${t}.${rawBody}`
 * (period-joined), HMAC-SHA256'd with the webhook endpoint's secret.
 *
 * This implementation deliberately only ever checks `te=` (test mode) —
 * never `li=` — since this integration is TEST MODE only by design; a
 * missing/empty `te=` is treated as unverifiable rather than silently
 * falling back to checking `li=`, so a live-mode event can never be
 * accidentally accepted by a test-mode-only verifier.
 */
export function constructPayMongoWebhookEvent(rawBody: string, signatureHeader: string): PayMongoEvent {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new PayMongoError("paymongo_not_configured", "PayMongo webhook isn't configured.");
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value ?? ""];
    })
  );
  const timestamp = parts.t;
  const testSignature = parts.te;

  if (!timestamp || !testSignature) {
    throw new PayMongoError("invalid_webhook_signature", "Malformed webhook signature header.");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const computedSignature = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  const expectedBuffer = Buffer.from(testSignature, "utf8");
  const computedBuffer = Buffer.from(computedSignature, "utf8");
  const signaturesMatch =
    expectedBuffer.length === computedBuffer.length && crypto.timingSafeEqual(expectedBuffer, computedBuffer);

  if (!signaturesMatch) {
    throw new PayMongoError("invalid_webhook_signature", "Webhook signature verification failed.");
  }

  return JSON.parse(rawBody) as PayMongoEvent;
}
