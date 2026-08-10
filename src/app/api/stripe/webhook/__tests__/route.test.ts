/**
 * @jest-environment node
 */
import { POST } from "../route";
import { constructWebhookEvent, PaymentError } from "../../../../../lib/services/payments";
import { confirmBookingPayment } from "../../../../../lib/services/bookings";
import { createClient } from "../../../../../lib/supabase/server";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/services/payments", () => {
  class PaymentError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "PaymentError";
    }
  }
  return {
    constructWebhookEvent: jest.fn(),
    PaymentError,
  };
});
jest.mock("../../../../../lib/services/bookings", () => ({ confirmBookingPayment: jest.fn() }));
jest.mock("../../../../../lib/supabase/server", () => ({ createClient: jest.fn() }));

const mockConstructWebhookEvent = constructWebhookEvent as jest.MockedFunction<typeof constructWebhookEvent>;
const mockConfirmBookingPayment = confirmBookingPayment as jest.MockedFunction<typeof confirmBookingPayment>;
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

function fakeRequest(body: string, signature: string | null = "t=1,v1=abc") {
  const headers = new Headers();
  if (signature) headers.set("stripe-signature", signature);
  return new Request("https://airrally.app/api/stripe/webhook", { method: "POST", headers, body });
}

const COMPLETED_SESSION = {
  id: "cs_test_123",
  payment_intent: "pi_test_456",
  amount_total: 50000,
  currency: "php",
  metadata: { booking_id: "booking-1", user_id: "user-1" },
};

const COMPLETED_EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: COMPLETED_SESSION },
} as never;

beforeEach(() => {
  mockConstructWebhookEvent.mockReset();
  mockConfirmBookingPayment.mockReset();
  mockCreateClient.mockReset();
  mockCreateClient.mockResolvedValue({} as never);
});

describe("POST /api/stripe/webhook", () => {
  it("returns 400 without touching Stripe or the database when the signature header is missing", async () => {
    const response = await POST(fakeRequest("{}", null));
    expect(response.status).toBe(400);
    expect(mockConstructWebhookEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification fails, and never calls confirmBookingPayment", async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const response = await POST(fakeRequest("raw-body", "bad-sig"));

    expect(response.status).toBe(400);
    expect(mockConfirmBookingPayment).not.toHaveBeenCalled();
  });

  it("verifies the exact raw request body (not a re-serialized/parsed one) against the signature", async () => {
    mockConstructWebhookEvent.mockReturnValue(COMPLETED_EVENT);
    mockConfirmBookingPayment.mockResolvedValue(true);

    const rawBody = '{"id":"evt_1","type":"checkout.session.completed"}';
    await POST(fakeRequest(rawBody, "t=1,v1=abc"));

    expect(mockConstructWebhookEvent).toHaveBeenCalledWith(rawBody, "t=1,v1=abc");
  });

  it("acknowledges with 200 and ignores any event type other than checkout.session.completed, never calling confirmBookingPayment", async () => {
    mockConstructWebhookEvent.mockReturnValue({ id: "evt_2", type: "payment_intent.succeeded", data: { object: {} } } as never);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmBookingPayment).not.toHaveBeenCalled();
  });

  it("confirms the booking via confirm_booking_payment on a valid checkout.session.completed event, passing Stripe's own amount/currency/ids exactly", async () => {
    mockConstructWebhookEvent.mockReturnValue(COMPLETED_EVENT);
    mockConfirmBookingPayment.mockResolvedValue(true);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmBookingPayment).toHaveBeenCalledWith(expect.anything(), {
      bookingId: "booking-1",
      stripeCheckoutSessionId: "cs_test_123",
      stripePaymentIntentId: "pi_test_456",
      expectedAmount: 50000,
      expectedCurrency: "PHP",
    });
    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: true });
  });

  it("is idempotent: a duplicate delivery of the same event still returns 200 even though confirmBookingPayment no-ops", async () => {
    mockConstructWebhookEvent.mockReturnValue(COMPLETED_EVENT);
    mockConfirmBookingPayment.mockResolvedValue(false);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ received: true, confirmed: false });
  });

  it("acknowledges with 200 rather than retrying forever when the session is missing booking_id/payment_intent/amount_total", async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { object: { id: "cs_bad", metadata: {}, payment_intent: null, amount_total: null } },
    } as never);

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(200);
    expect(mockConfirmBookingPayment).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking the raw error when confirmBookingPayment itself throws a PaymentError", async () => {
    mockConstructWebhookEvent.mockReturnValue(COMPLETED_EVENT);
    mockConfirmBookingPayment.mockRejectedValue(new PaymentError("stripe_not_configured", "Webhook isn't configured."));

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(500);
  });

  it("returns 500 for an unexpected database error rather than crashing", async () => {
    mockConstructWebhookEvent.mockReturnValue(COMPLETED_EVENT);
    mockConfirmBookingPayment.mockRejectedValue(new Error("connection reset"));

    const response = await POST(fakeRequest("{}"));

    expect(response.status).toBe(500);
  });
});
