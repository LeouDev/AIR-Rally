/**
 * @jest-environment node
 */
import type { Booking } from "@/lib/supabase/types";

const mockSessionsCreate = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockConstructEvent = jest.fn();

// The mock constructor always returns the same jest.fn()s regardless of how
// many times `new Stripe(...)` runs, so payments.ts's module-level
// singleton (`stripeClient ??= new Stripe(...)`) doesn't interfere with
// per-test assertions here.
jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  checkout: {
    sessions: {
      create: mockSessionsCreate,
      retrieve: mockSessionsRetrieve,
    },
  },
  webhooks: {
    constructEvent: mockConstructEvent,
  },
})));

import { createCheckoutSession, retrieveCheckoutSession, constructWebhookEvent, PaymentError } from "../payments";

const originalSecretKey = process.env.STRIPE_SECRET_KEY;
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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
  payment_provider: "stripe",
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
  successUrl: "https://airrally.app/bookings/booking-1/confirmation?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://airrally.app/bookings/booking-1/confirmation?cancelled=true",
};

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  mockSessionsCreate.mockReset();
  mockSessionsRetrieve.mockReset();
  mockConstructEvent.mockReset();
});

afterAll(() => {
  if (originalSecretKey !== undefined) process.env.STRIPE_SECRET_KEY = originalSecretKey;
  if (originalWebhookSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
});

describe("createCheckoutSession", () => {
  it("throws a typed PaymentError when STRIPE_SECRET_KEY isn't configured, without ever calling Stripe", async () => {
    await expect(createCheckoutSession(CHECKOUT_INPUT)).rejects.toMatchObject({ reason: "stripe_not_configured" });
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("charges exactly the booking's stored price_amount and currency — never a client-supplied amount", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" });

    await createCheckoutSession(CHECKOUT_INPUT);

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: "php",
              unit_amount: 50000,
            }),
          }),
        ],
      })
    );
  });

  it("sets metadata to exactly booking_id and user_id, nothing more sensitive", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" });

    await createCheckoutSession(CHECKOUT_INPUT);

    const call = mockSessionsCreate.mock.calls[0][0];
    expect(call.metadata).toEqual({ booking_id: "booking-1", user_id: "user-1" });
  });

  it("passes the given success/cancel URLs through unchanged", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" });

    await createCheckoutSession(CHECKOUT_INPUT);

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: CHECKOUT_INPUT.successUrl,
        cancel_url: CHECKOUT_INPUT.cancelUrl,
      })
    );
  });

  it("wraps a Stripe API failure in a typed PaymentError, never leaking the raw error to the caller", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    mockSessionsCreate.mockRejectedValue(new Error("Stripe API is down"));

    let caught: unknown;
    try {
      await createCheckoutSession(CHECKOUT_INPUT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ reason: "checkout_session_creation_failed" });
    expect((caught as Error).message).not.toBe("Stripe API is down");
  });
});

describe("retrieveCheckoutSession", () => {
  it("fetches the session by id directly from Stripe's API", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    mockSessionsRetrieve.mockResolvedValue({ id: "cs_1", payment_status: "paid" });

    await expect(retrieveCheckoutSession("cs_1")).resolves.toEqual({ id: "cs_1", payment_status: "paid" });
    expect(mockSessionsRetrieve).toHaveBeenCalledWith("cs_1");
  });

  it("throws a typed PaymentError when Stripe isn't configured", async () => {
    await expect(retrieveCheckoutSession("cs_1")).rejects.toMatchObject({ reason: "stripe_not_configured" });
  });
});

describe("constructWebhookEvent", () => {
  it("throws a typed PaymentError when STRIPE_WEBHOOK_SECRET isn't configured, without calling Stripe", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(() => constructWebhookEvent("{}", "sig")).toThrow(PaymentError);
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("verifies the raw body's signature via stripe.webhooks.constructEvent and returns the parsed event", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const event = { id: "evt_1", type: "checkout.session.completed" };
    mockConstructEvent.mockReturnValue(event);

    expect(constructWebhookEvent("raw-body", "t=1,v1=abc")).toEqual(event);
    expect(mockConstructEvent).toHaveBeenCalledWith("raw-body", "t=1,v1=abc", "whsec_x");
  });

  it("propagates a signature verification failure rather than swallowing it", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    expect(() => constructWebhookEvent("raw-body", "bad-sig")).toThrow(/No signatures found/);
  });
});
