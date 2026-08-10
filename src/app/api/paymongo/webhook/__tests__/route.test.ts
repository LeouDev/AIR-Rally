/**
 * @jest-environment node
 */
import { POST } from "../route";
import { constructPayMongoWebhookEvent, PayMongoError } from "../../../../../lib/services/paymongo";
import { confirmPaymongoBookingPayment } from "../../../../../lib/services/bookings";
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
jest.mock("../../../../../lib/supabase/server", () => ({ createClient: jest.fn() }));

const mockConstructEvent = constructPayMongoWebhookEvent as jest.MockedFunction<typeof constructPayMongoWebhookEvent>;
const mockConfirmPayment = confirmPaymongoBookingPayment as jest.MockedFunction<typeof confirmPaymongoBookingPayment>;
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

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
    expect(json).toEqual({ received: true, confirmed: true });
  });

  it("is idempotent: a duplicate delivery of the same event still returns 200 even though confirmPaymongoBookingPayment no-ops", async () => {
    mockConstructEvent.mockReturnValue(PAID_EVENT);
    mockConfirmPayment.mockResolvedValue(false);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: false });
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
