import crypto from "node:crypto";
import type { Booking } from "@/lib/supabase/types";
import { logServerError } from "@/lib/errors";

const PAYMONGO_API_BASE = "https://api.paymongo.com/v1";
/**
 * Checkout Sessions specifically move to v2 (see ARCHITECTURE.md's
 * PayMongo Platforms section) — confirmed via PayMongo's own raw OpenAPI
 * schema that `split_payment`/`pass_on_fees` only exist on `POST
 * /v2/checkout_sessions`, and the docs' own guidance ("Recommended for
 * new integrations: future features are only supported on v2"). Every
 * other endpoint (retrieve, webhook signature) is unaffected and stays
 * on v1 — confirmed the shared "Get checkout session" endpoint resolves
 * both v1- and v2-created sessions ("First checks DynamoDB, then falls
 * back to core-api for legacy sessions").
 */
const PAYMONGO_CHECKOUT_V2_BASE = "https://api.paymongo.com/v2";

export type PayMongoErrorReason =
  | "paymongo_not_configured"
  | "checkout_session_creation_failed"
  | "invalid_webhook_signature"
  | "account_onboarding_failed";

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

/**
 * PayMongo's `errors[].detail` is usually a plain string, but at least one
 * real, empirically-observed error code — `available_balance_insufficient`,
 * hit during this project's live two-party refund verification (see
 * ARCHITECTURE.md) — returns an OBJECT (`{ message, merchants }`) instead.
 * Never assume the string shape; normalize defensively so a real error
 * becomes a readable message instead of "[object Object]".
 */
export function describePayMongoErrorDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return undefined;
}

export function getSecretKey(): string {
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
async function paymongoRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; base?: string } = {}
): Promise<T> {
  const secretKey = getSecretKey();
  const response = await fetch(`${options.base ?? PAYMONGO_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json()) as { data?: T; errors?: Array<{ code: string; detail: unknown }> };
  if (!response.ok) {
    throw new Error(describePayMongoErrorDetail(json.errors?.[0]?.detail) ?? `PayMongo API returned ${response.status}`);
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
  /**
   * Present only when the venue is a fully activated PayMongo Platforms
   * child account (see lib/actions/checkout.ts) — omitted entirely falls
   * back to the plain, pre-existing non-split checkout flow. Computed by
   * lib/services/commission.ts: 5% of the gross booking price, integer
   * minor units, never from a post-fee amount.
   */
  marketplaceSplit?: {
    platformFeeAmount: number;
    venuePaymongoAccountId: string;
  };
  /**
   * Overrides the line-item amount charged — used only by
   * lib/services/reschedules.ts for a price-increase reschedule's
   * difference-only checkout, where the customer must pay just the
   * difference between the two bookings' prices, never the replacement
   * booking's own full price. Omitted (the default) for every existing
   * caller, which continues to charge booking.price_amount exactly as
   * before this field existed.
   */
  chargeAmountOverride?: number;
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
 *
 * Uses `/v2/checkout_sessions` for every session, split or not — v2 is a
 * confirmed superset of v1 for creation (same line_items/payment_method_
 * types/metadata/success_url/cancel_url fields, per PayMongo's own raw
 * OpenAPI schema), so there's no reason to keep two code paths.
 *
 * `split_payment` is attached only when `marketplaceSplit` is given — its
 * shape (`recipients[].merchant_id`/`split_type`/`value` +
 * `transfer_to`) is confirmed directly from PayMongo's own Linked
 * Transactions documentation example, not guessed. `split_type: "fixed"`
 * is used deliberately (never `"percentage_net"`, whose rounding
 * behavior isn't documented) — both amounts are computed by AIR/Rally
 * itself in integer minor units, so PayMongo never needs to round
 * anything for the split to be exact.
 *
 * `pass_on_fees` is deliberately NOT enabled here yet. Whether PayMongo
 * reports the *paid* Payment's `amount` as the original line-item total
 * or as that total plus the passed-on fee is unconfirmed — and
 * confirm_paymongo_booking_payment()'s amount-integrity check compares
 * against the booking's own `price_amount`. Guessing wrong would silently
 * break confirmation for every split payment. Deferred to live TEST MODE
 * verification (see ARCHITECTURE.md) rather than assumed.
 */
export async function createPayMongoCheckoutSession(input: CreatePayMongoCheckoutSessionInput): Promise<PayMongoCheckoutSession> {
  const { booking, venueName, courtName, successUrl, cancelUrl, marketplaceSplit, chargeAmountOverride } = input;

  try {
    const attributes: Record<string, unknown> = {
      send_email_receipt: false,
      show_line_items: true,
      line_items: [
        {
          currency: booking.currency,
          amount: chargeAmountOverride ?? booking.price_amount,
          name: `${venueName} — ${courtName}`,
          quantity: 1,
        },
      ],
      payment_method_types: ["card", "gcash", "paymaya", "qrph"],
      metadata: { booking_id: booking.id, user_id: booking.user_id },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (marketplaceSplit) {
      const platformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
      if (!platformAccountId) {
        throw new PayMongoError(
          "paymongo_not_configured",
          "PAYMONGO_PLATFORM_ACCOUNT_ID isn't set — add it to .env.local (see .env.example) before a venue can go through the marketplace split."
        );
      }
      attributes.split_payment = {
        recipients: [{ merchant_id: platformAccountId, split_type: "fixed", value: marketplaceSplit.platformFeeAmount }],
        transfer_to: marketplaceSplit.venuePaymongoAccountId,
      };
    }

    const session = await paymongoRequest<PayMongoCheckoutSessionResponse>("/checkout_sessions", {
      method: "POST",
      base: PAYMONGO_CHECKOUT_V2_BASE,
      body: { data: { attributes } },
    });

    if (!session.attributes.checkout_url) {
      throw new Error("PayMongo did not return a checkout_url");
    }
    return { id: session.id, url: session.attributes.checkout_url };
  } catch (error) {
    if (error instanceof PayMongoError) throw error;
    logServerError("paymongo.createCheckoutSession", error);
    throw new PayMongoError("checkout_session_creation_failed", "We couldn't start checkout — please try again.");
  }
}

type PayMongoPaymentIntentAttributes = {
  amount: number;
  currency: string;
  status: string;
  payments: Array<{
    id: string;
    attributes: {
      amount: number;
      currency: string;
      status: string;
      /**
       * Settlement estimates, present on a real payment object — purely
       * informational when persisted (see reconcilePaymongoPendingBooking()
       * in lib/services/bookings.ts). Optional because not every response
       * shape observed during this project's verification included them.
       */
      available_at?: number | null;
      credited_at?: number | null;
    };
  }>;
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

export type PayMongoPaymentDetail = {
  id: string;
  attributes: {
    status: string;
    /** The payment method actually used — "qrph" is the one confirmed-unrefundable value (see ARCHITECTURE.md). Never guessed; read straight from the real API response. */
    source: { type: string } | null;
  };
};

/**
 * Read-only — GET /v1/payments/{id}, confirmed real endpoint from this
 * project's own live verification. Used by lib/services/refunds.ts
 * purely to detect a payment method PayMongo has confirmed it will
 * reject a refund for (QR Ph) *before* ever attempting the refund call,
 * so that rejection is handled as a known, recorded state
 * ("provider_unavailable") rather than a generic provider failure. Never
 * used to move money — this function makes no write of any kind.
 */
export async function retrievePayMongoPayment(paymentId: string): Promise<PayMongoPaymentDetail> {
  return paymongoRequest<PayMongoPaymentDetail>(`/payments/${paymentId}`);
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
 * Shape of the `data.attributes.data` payload for merchant.activated /
 * merchant.declined events (see ARCHITECTURE.md's PayMongo Platforms
 * section) — confirmed verbatim against PayMongo's real onboarding
 * webhooks documentation, not guessed. Deliberately not merged into
 * PayMongoEvent's checkout-session-shaped `data` field above (the two
 * event families carry structurally unrelated payloads); the webhook
 * route casts to this type only after checking `event.data.attributes.type`.
 */
export type PayMongoMerchantActivationEventData = {
  merchant_id: string;
  account: { legal_name?: string; trade_name?: string; type?: string };
  activation_status: "activated" | "declined";
  declined_message?: string;
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
