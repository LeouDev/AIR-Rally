/**
 * @jest-environment node
 */
import { POST } from "../route";
import { constructPayMongoWebhookEvent, PayMongoError } from "../../../../../lib/services/paymongo";
import { confirmPaymongoBookingPayment } from "../../../../../lib/services/bookings";
import { syncVenuePaymongoActivation } from "../../../../../lib/services/venues";
import { maybeCompleteReschedule } from "../../../../../lib/services/reschedules";
import { createClient } from "../../../../../lib/supabase/server";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/services/paymongo", () => {
  class PayMongoError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "PayMongoError";
    }
  }
  return {
    constructPayMongoWebhookEvent: jest.fn(),
    PayMongoError,
  };
});
jest.mock("../../../../../lib/services/bookings", () => ({ confirmPaymongoBookingPayment: jest.fn() }));
jest.mock("../../../../../lib/services/venues", () => ({ syncVenuePaymongoActivation: jest.fn() }));
jest.mock("../../../../../lib/services/reschedules", () => ({ maybeCompleteReschedule: jest.fn() }));
jest.mock("../../../../../lib/supabase/server", () => ({ createClient: jest.fn() }));

const mockConstructEvent = constructPayMongoWebhookEvent as jest.MockedFunction<typeof constructPayMongoWebhookEvent>;
const mockConfirmPayment = confirmPaymongoBookingPayment as jest.MockedFunction<typeof confirmPaymongoBookingPayment>;
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockSyncActivation = syncVenuePaymongoActivation as jest.MockedFunction<typeof syncVenuePaymongoActivation>;
const mockMaybeCompleteReschedule = maybeCompleteReschedule as jest.MockedFunction<typeof maybeCompleteReschedule>;

function fakeRequest(body: string, signature: string | null = "t=1,te=abc,li=") {
  const headers = new Headers();
  if (signature) headers.set("paymongo-signature", signature);
  return new Request("https://airrally.app/api/paymongo/webhook", { method: "POST", headers, body });
}

const PAID_CHECKOUT_SESSION = {
  id: "cs_test_123",
  type: "checkout_session",
  attributes: {
    metadata: { booking_id: "booking-1", user_id: "user-1" },
    payment_intent: {
      id: "pi_test_456",
      attributes: {
        amount: 50000,
        currency: "PHP",
        status: "succeeded",
        payments: [{ id: "pay_1", attributes: { amount: 50000, currency: "PHP", status: "paid" } }],
      },
    },
  },
};

const PAID_EVENT = {
  data: {
    id: "evt_1",
    type: "event",
    attributes: { type: "checkout_session.payment.paid", livemode: false, data: PAID_CHECKOUT_SESSION },
  },
} as never;

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockConfirmPayment.mockReset();
  mockCreateClient.mockReset();
  mockCreateClient.mockResolvedValue({} as never);
  mockSyncActivation.mockReset();
  mockMaybeCompleteReschedule.mockReset();
  mockMaybeCompleteReschedule.mockResolvedValue(false);
});

describe("POST /api/paymongo/webhook", () => {
  it("returns 400 without touching PayMongo or the database when the signature header is missing", async () => {
    const response = await POST(fakeRequest("{}", null));
    expect(response.status).toBe(400);
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification fails, and never calls confirmPaymongoBookingPayment", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new PayMongoError("invalid_webhook_signature", "Webhook signature verification failed.");
    });

    const response = await POST(fakeRequest("raw-body", "t=1,te=bad,li="));

    expect(response.status).toBe(400);
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it("verifies the exact raw request body against the signature", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockResolvedValue(true);

    const rawBody = '{"data":{"id":"evt_1"}}';
    await POST(fakeRequest(rawBody, "t=1,te=abc,li="));

    expect(mockConstructEvent).toHaveBeenCalledWith(rawBody, "t=1,te=abc,li=");
  });

  it("acknowledges with 200 and ignores any event type other than checkout_session.payment.paid, never calling confirmPaymongoBookingPayment", async () => {
    mockConstructEvent.mockReturnValue({
      data: { id: "evt_2", type: "event", attributes: { type: "payment.failed", livemode: false, data: {} } },
    } as never);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it("confirms the booking on a valid checkout_session.payment.paid event, passing PayMongo's own amount/currency/ids exactly", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockResolvedValue(true);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmPayment).toHaveBeenCalledWith(expect.anything(), {
      bookingId: "booking-1",
      paymongoCheckoutSessionId: "cs_test_123",
      paymongoPaymentIntentId: "pi_test_456",
      expectedAmount: 50000,
      expectedCurrency: "PHP",
    });
    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: true, rescheduleCompleted: false });
    // Additive, after the existing confirm call — a reschedule
    // difference-checkout session's amount never matches the
    // replacement's own price_amount by design, so this always fires
    // regardless of `confirmed`.
    expect(mockMaybeCompleteReschedule).toHaveBeenCalledWith(expect.anything(), "booking-1", 50000, "PHP", "cs_test_123");
  });

  it("is idempotent: a duplicate delivery of the same event still returns 200 even though confirmPaymongoBookingPayment no-ops", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockResolvedValue(false);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: false, rescheduleCompleted: false });
  });

  it("completes a reschedule when maybeCompleteReschedule reports the difference-checkout session actually matched one", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockResolvedValue(false); // the difference amount never matches price_amount, by design
    mockMaybeCompleteReschedule.mockResolvedValue(true);

    const response = await POST(fakeRequest("{}"));

    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: false, rescheduleCompleted: true });
  });

  it("acknowledges with 200 rather than retrying forever when the session is missing booking_id/payment_intent/a paid payment", async () => {
    mockConstructEvent.mockReturnValue({
      data: {
        id: "evt_3",
        type: "event",
        attributes: {
          type: "checkout_session.payment.paid",
          livemode: false,
          data: { id: "cs_bad", type: "checkout_session", attributes: { metadata: {}, payment_intent: null } },
        },
      },
    } as never);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking the raw error when confirmPaymongoBookingPayment itself throws a PayMongoError", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockRejectedValue(new PayMongoError("paymongo_not_configured", "PayMongo isn't set up yet."));

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(500);
  });

  it("returns 500 for an unexpected database error rather than crashing", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockRejectedValue(new Error("connection reset"));

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(500);
  });
});

describe("POST /api/paymongo/webhook — merchant activation events", () => {
  function activationEvent(type: "merchant.activated" | "merchant.declined", data: Record<string, unknown>) {
    return {
      data: { id: "evt_activation", type: "event", attributes: { type, livemode: false, data } },
    } as never;
  }

  it("syncs the venue as activated and never calls confirmPaymongoBookingPayment", async () => {
    mockConstructEvent.mockReturnValue(
      activationEvent("merchant.activated", { merchant_id: "org_venue_1", activation_status: "activated" })
    );
    mockSyncActivation.mockResolvedValue(true);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockSyncActivation).toHaveBeenCalledWith(expect.anything(), {
      paymongoAccountId: "org_venue_1",
      activationStatus: "activated",
      declinedReason: null,
    });
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json).toEqual({ received: true, synced: true });
  });

  it("syncs a decline with its reason", async () => {
    mockConstructEvent.mockReturnValue(
      activationEvent("merchant.declined", {
        merchant_id: "org_venue_2",
        activation_status: "declined",
        declined_message: "KYC failed",
      })
    );
    mockSyncActivation.mockResolvedValue(true);

    await POST(fakeRequest("{}"));

    expect(mockSyncActivation).toHaveBeenCalledWith(expect.anything(), {
      paymongoAccountId: "org_venue_2",
      activationStatus: "declined",
      declinedReason: "KYC failed",
    });
  });

  it("is a safe no-op (still 200) when the event matches no linked venue", async () => {
    mockConstructEvent.mockReturnValue(
      activationEvent("merchant.activated", { merchant_id: "org_unknown", activation_status: "activated" })
    );
    mockSyncActivation.mockResolvedValue(false);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ received: true, synced: false });
  });

  it("returns 500 without crashing when syncVenuePaymongoActivation throws", async () => {
    mockConstructEvent.mockReturnValue(
      activationEvent("merchant.activated", { merchant_id: "org_venue_3", activation_status: "activated" })
    );
    mockSyncActivation.mockRejectedValue(new Error("connection reset"));

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(500);
  });
});
