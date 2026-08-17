/**
 * @jest-environment node
 */
import crypto from "node:crypto";
import type { Booking } from "@/lib/supabase/types";

const originalSecretKey = process.env.PAYMONGO_SECRET_KEY;
const originalWebhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
const originalPlatformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
const originalFetch = global.fetch;

const mockFetch = jest.fn();

beforeEach(() => {
  delete process.env.PAYMONGO_SECRET_KEY;
  delete process.env.PAYMONGO_WEBHOOK_SECRET;
  delete process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  if (originalSecretKey !== undefined) process.env.PAYMONGO_SECRET_KEY = originalSecretKey;
  if (originalWebhookSecret !== undefined) process.env.PAYMONGO_WEBHOOK_SECRET = originalWebhookSecret;
  if (originalPlatformAccountId !== undefined) process.env.PAYMONGO_PLATFORM_ACCOUNT_ID = originalPlatformAccountId;
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const BOOKING: Booking = {
  id: "booking-1",
  court_id: "court-1",
  user_id: "user-1",
  start_time: "2026-08-12T00:00:00Z",
  end_time: "2026-08-12T01:00:00Z",
  status: "pending",
  price_amount: 50000,
  currency: "PHP",
  confirmation_code: "ABCD1234",
  cancelled_at: null,
  cancelled_by: null,
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  paid_at: null,
  payment_provider: "paymongo",
  credit_amount_applied: 0,
  processing_fee_amount: 0,
  paymongo_checkout_session_id: null,
  paymongo_payment_intent_id: null,
  platform_fee_amount: null,
  venue_amount: null,
  paymongo_venue_account_id: null,
  paymongo_available_at: null,
  paymongo_credited_at: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

const CHECKOUT_INPUT = {
  booking: BOOKING,
  venueName: "Rizal Pickleball Club",
  courtName: "Court 1",
  successUrl: "https://airrally.app/bookings/booking-1/confirmation",
  cancelUrl: "https://airrally.app/bookings/booking-1/confirmation?cancelled=true",
};

describe("createPayMongoCheckoutSession", () => {
  it("throws a typed PayMongoError when PAYMONGO_SECRET_KEY isn't configured, without ever calling the API", async () => {
    const { createPayMongoCheckoutSession } = await import("../paymongo");
    await expect(createPayMongoCheckoutSession(CHECKOUT_INPUT)).rejects.toMatchObject({ reason: "paymongo_not_configured" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps the not-configured message customer-safe, with the deployment detail on .detail", async () => {
    // checkout.ts and reschedule.ts both return PayMongoError.message
    // straight to the browser. This once shipped "add PAYMONGO_SECRET_KEY
    // to .env.local" to a real player mid-checkout — asserting on `reason`
    // alone (the test above) never caught it.
    const { createPayMongoCheckoutSession } = await import("../paymongo");
    const error = await createPayMongoCheckoutSession(CHECKOUT_INPUT).catch((e: unknown) => e);

    const message = (error as Error).message;
    expect(message).not.toMatch(/PAYMONGO_|\.env|process\.env|Vercel/i);
    expect(message).toBe("Payments are temporarily unavailable — please try again shortly.");
    expect((error as { detail?: string }).detail).toMatch(/PAYMONGO_SECRET_KEY/);
  });

  it("charges exactly the booking's stored price_amount/currency, and sets booking_id/user_id metadata — never a client-supplied amount", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(
      jsonResponse({ data: { id: "cs_1", attributes: { checkout_url: "https://checkout.paymongo.com/cs_1" } } })
    );

    const { createPayMongoCheckoutSession } = await import("../paymongo");
    const result = await createPayMongoCheckoutSession(CHECKOUT_INPUT);

    expect(result).toEqual({ id: "cs_1", url: "https://checkout.paymongo.com/cs_1" });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.paymongo.com/v2/checkout_sessions");
    const body = JSON.parse(options.body);
    expect(body.data.attributes.line_items[0]).toMatchObject({ amount: 50000, currency: "PHP" });
    expect(body.data.attributes.metadata).toEqual({ booking_id: "booking-1", user_id: "user-1" });
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from("sk_test_x:").toString("base64")}`);
  });

  it("wraps an API failure in a typed PayMongoError, never leaking the raw error", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ code: "resource_not_found", detail: "nope" }] }, false, 400));

    const { createPayMongoCheckoutSession } = await import("../paymongo");
    let caught: unknown;
    try {
      await createPayMongoCheckoutSession(CHECKOUT_INPUT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ reason: "checkout_session_creation_failed" });
    expect((caught as Error).message).not.toBe("nope");
  });

  it("attaches split_payment with a 'fixed' split when marketplaceSplit is given, using PAYMONGO_PLATFORM_ACCOUNT_ID as the recipient", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    process.env.PAYMONGO_PLATFORM_ACCOUNT_ID = "org_air_rally_platform";
    mockFetch.mockResolvedValue(
      jsonResponse({ data: { id: "cs_2", attributes: { checkout_url: "https://checkout.paymongo.com/cs_2" } } })
    );

    const { createPayMongoCheckoutSession } = await import("../paymongo");
    await createPayMongoCheckoutSession({
      ...CHECKOUT_INPUT,
      marketplaceSplit: { platformFeeAmount: 2500, venuePaymongoAccountId: "org_venue_1" },
    });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.data.attributes.split_payment).toEqual({
      recipients: [{ merchant_id: "org_air_rally_platform", split_type: "fixed", value: 2500 }],
      transfer_to: "org_venue_1",
    });
    // pass_on_fees is deliberately not sent yet — see ARCHITECTURE.md.
    expect(body.data.attributes.pass_on_fees).toBeUndefined();
  });

  it("never attaches split_payment when marketplaceSplit is omitted — the plain, pre-existing checkout path", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "cs_3", attributes: { checkout_url: "https://checkout.paymongo.com/cs_3" } } }));

    const { createPayMongoCheckoutSession } = await import("../paymongo");
    await createPayMongoCheckoutSession(CHECKOUT_INPUT);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.data.attributes.split_payment).toBeUndefined();
  });

  it("throws a typed PayMongoError, without ever calling the API, when marketplaceSplit is given but PAYMONGO_PLATFORM_ACCOUNT_ID isn't set", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";

    const { createPayMongoCheckoutSession } = await import("../paymongo");
    await expect(
      createPayMongoCheckoutSession({
        ...CHECKOUT_INPUT,
        marketplaceSplit: { platformFeeAmount: 2500, venuePaymongoAccountId: "org_venue_1" },
      })
    ).rejects.toMatchObject({ reason: "paymongo_not_configured" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("createPayMongoCheckoutSession — passing PayMongo's fee to the customer", () => {
  const ORIGINAL_GATE = process.env.PAYMONGO_PASS_ON_FEES_ENABLED;

  afterEach(() => {
    if (ORIGINAL_GATE === undefined) delete process.env.PAYMONGO_PASS_ON_FEES_ENABLED;
    else process.env.PAYMONGO_PASS_ON_FEES_ENABLED = ORIGINAL_GATE;
  });

  async function createWith(passOnFees: boolean | undefined) {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "cs_f", attributes: { checkout_url: "https://checkout.paymongo.com/cs_f" } } }));
    const { createPayMongoCheckoutSession } = await import("../paymongo");
    await createPayMongoCheckoutSession({ ...CHECKOUT_INPUT, passOnFees });
    return JSON.parse(mockFetch.mock.calls[0][1].body);
  }

  it("sends pass_on_fees when the caller opts in and the gate is on", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    const body = await createWith(true);
    expect(body.data.attributes.pass_on_fees).toBe(true);
  });

  it("does not send it when the gate is off, however the caller asks", async () => {
    delete process.env.PAYMONGO_PASS_ON_FEES_ENABLED;
    const body = await createWith(true);
    expect(body.data.attributes.pass_on_fees).toBeUndefined();
  });

  it("does not send it for a caller that did not opt in, even with the gate on", async () => {
    // The reschedule path. It confirms against price_difference, which has
    // no fee term, so a passed-on fee there strands the customer on
    // 'pending_payment' after paying.
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    const body = await createWith(undefined);
    expect(body.data.attributes.pass_on_fees).toBeUndefined();
  });
});

describe("pass-on-fees payment-method guard", () => {
  it("only offers methods whose fee calculateBookingCharge() can predict", async () => {
    // THE POINT OF THIS TEST: adding a method to PAYMENT_METHOD_TYPES
    // (GCash 2.23%, cards 3.125% + ₱13.39) without measuring its fee and
    // extending PASS_ON_FEES_VERIFIED_METHODS would leave every stored
    // processing_fee_amount wrong. confirm_paymongo_booking_payment()
    // would then match zero rows and paid bookings would sit on 'pending'
    // forever — silently, with no failed request anywhere.
    //
    // If this test fails, do NOT widen the verified list to make it pass.
    // Measure the new method's real fee against a live payment first.
    const { PAYMENT_METHOD_TYPES, PASS_ON_FEES_VERIFIED_METHODS } = await import("../paymongo");
    const unverified = PAYMENT_METHOD_TYPES.filter((m) => !PASS_ON_FEES_VERIFIED_METHODS.includes(m));
    expect(unverified).toEqual([]);
  });

  it("refuses the combination outright, so no session can be created to pay", async () => {
    const { assertPassOnFeesSupported } = await import("../paymongo");
    expect(() => assertPassOnFeesSupported(["qrph", "gcash"])).toThrow(
      expect.objectContaining({ reason: "pass_on_fees_unverified_method" })
    );
  });

  it("keeps that failure's customer-facing message free of deployment detail", async () => {
    const { assertPassOnFeesSupported } = await import("../paymongo");
    const error = (() => {
      try {
        assertPassOnFeesSupported(["gcash"]);
      } catch (e) {
        return e as Error & { detail?: string };
      }
    })();
    expect(error?.message).toBe("Payments are temporarily unavailable — please try again shortly.");
    expect(error?.message).not.toMatch(/PAYMONGO_|processing_fee_amount|gcash/i);
    expect(error?.detail).toMatch(/gcash/);
  });

  it("passes the methods actually offered today", async () => {
    const { assertPassOnFeesSupported, PAYMENT_METHOD_TYPES } = await import("../paymongo");
    expect(() => assertPassOnFeesSupported(PAYMENT_METHOD_TYPES)).not.toThrow();
  });
});

describe("retrievePayMongoCheckoutSession", () => {
  it("fetches the session by id directly from PayMongo's API", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "cs_1", attributes: { payment_intent: null } } }));

    const { retrievePayMongoCheckoutSession } = await import("../paymongo");
    const result = await retrievePayMongoCheckoutSession("cs_1");

    expect(result).toEqual({ id: "cs_1", attributes: { payment_intent: null } });
    expect(mockFetch).toHaveBeenCalledWith("https://api.paymongo.com/v1/checkout_sessions/cs_1", expect.objectContaining({ method: "GET" }));
  });
});

describe("retrievePayMongoPayment", () => {
  it("fetches the payment by id directly from PayMongo's API — read-only, no write of any kind", async () => {
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "pay_1", attributes: { status: "paid", source: { type: "qrph" } } } }));

    const { retrievePayMongoPayment } = await import("../paymongo");
    const result = await retrievePayMongoPayment("pay_1");

    expect(result).toEqual({ id: "pay_1", attributes: { status: "paid", source: { type: "qrph" } } });
    expect(mockFetch).toHaveBeenCalledWith("https://api.paymongo.com/v1/payments/pay_1", expect.objectContaining({ method: "GET" }));
  });
});

describe("constructPayMongoWebhookEvent", () => {
  const rawBody = JSON.stringify({
    data: { id: "evt_1", type: "event", attributes: { type: "checkout_session.payment.paid", livemode: false, data: { id: "cs_1" } } },
  });

  function sign(secret: string, timestamp: string, body: string) {
    return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  }

  it("throws when PAYMONGO_WEBHOOK_SECRET isn't configured", async () => {
    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(rawBody, "t=1,te=abc,li=")).toThrow(/isn't configured/);
  });

  it("throws on a malformed header missing t= or te=", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(rawBody, "te=abc,li=")).toThrow(/[Mm]alformed/);
    expect(() => constructPayMongoWebhookEvent(rawBody, "t=1,li=")).toThrow(/[Mm]alformed/);
  });

  it("verifies a correctly-signed real payload and parses it (the real t=./rawBody HMAC-SHA256 algorithm)", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, rawBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    const event = constructPayMongoWebhookEvent(rawBody, `t=${timestamp},te=${signature},li=`);

    expect(event.data.attributes.type).toBe("checkout_session.payment.paid");
  });

  it("rejects a tampered body even with an otherwise well-formed header", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, rawBody);
    const tamperedBody = rawBody.replace("cs_1", "cs_evil");

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(tamperedBody, `t=${timestamp},te=${signature},li=`)).toThrow(
      /signature verification failed/i
    );
  });

  it("rejects a signature computed with the wrong secret", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    const timestamp = "1700000000";
    const wrongSignature = sign("whsec_someone_else", timestamp, rawBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(rawBody, `t=${timestamp},te=${wrongSignature},li=`)).toThrow(
      /signature verification failed/i
    );
  });

  // Live mode puts the HMAC in li= and leaves te= EMPTY. Every test above
  // sends `li=` empty, so nothing here ever exercised a real live
  // delivery — which is why a live deployment silently rejected every
  // webhook, leaving genuinely-paid bookings stuck on 'pending'.
  const liveBody = JSON.stringify({
    data: { id: "evt_1", type: "event", attributes: { type: "checkout_session.payment.paid", livemode: true, data: { id: "cs_1" } } },
  });

  it("verifies a live-mode delivery, where the HMAC is in li= and te= is empty", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    process.env.PAYMONGO_SECRET_KEY = "sk_live_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, liveBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    const event = constructPayMongoWebhookEvent(liveBody, `t=${timestamp},te=,li=${signature}`);

    expect(event.data.attributes.type).toBe("checkout_session.payment.paid");
  });

  it("still refuses a live-mode delivery when this deployment holds test keys", async () => {
    // The original mode isolation, preserved: a test-mode deployment must
    // never accept a live event just because li= happens to be signed.
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, liveBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(liveBody, `t=${timestamp},te=,li=${signature}`)).toThrow(/[Mm]alformed/);
  });

  it("refuses a test-mode delivery when this deployment holds live keys — isolation in both directions", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    process.env.PAYMONGO_SECRET_KEY = "sk_live_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, rawBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(rawBody, `t=${timestamp},te=${signature},li=`)).toThrow(/[Mm]alformed/);
  });

  it("rejects a tampered body in live mode too", async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsec_x";
    process.env.PAYMONGO_SECRET_KEY = "sk_live_x";
    const timestamp = "1700000000";
    const signature = sign("whsec_x", timestamp, liveBody);

    const { constructPayMongoWebhookEvent } = await import("../paymongo");
    expect(() => constructPayMongoWebhookEvent(liveBody.replace("cs_1", "cs_evil"), `t=${timestamp},te=,li=${signature}`)).toThrow(
      /signature verification failed/i
    );
  });
});

describe("describePayMongoErrorDetail", () => {
  it("passes through a plain string detail unchanged", async () => {
    const { describePayMongoErrorDetail } = await import("../paymongo");
    expect(describePayMongoErrorDetail("Something went wrong.")).toBe("Something went wrong.");
  });

  it("extracts .message from an object detail — the real shape PayMongo returns for available_balance_insufficient", async () => {
    const { describePayMongoErrorDetail } = await import("../paymongo");
    const realShape = {
      message: "This refund cannot proceed due to insufficient payout balances.",
      merchants: [{ id: "org_e4fd8c5c83a7a3c155126682", trade_name: "Test Venue" }],
    };
    expect(describePayMongoErrorDetail(realShape)).toBe("This refund cannot proceed due to insufficient payout balances.");
  });

  it("returns undefined for a detail shape with no usable message, rather than throwing or stringifying '[object Object]'", async () => {
    const { describePayMongoErrorDetail } = await import("../paymongo");
    expect(describePayMongoErrorDetail({ merchants: [] })).toBeUndefined();
    expect(describePayMongoErrorDetail(undefined)).toBeUndefined();
    expect(describePayMongoErrorDetail(null)).toBeUndefined();
  });
});
