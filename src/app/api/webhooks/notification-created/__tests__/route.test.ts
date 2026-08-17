/**
 * @jest-environment node
 */
import { POST } from "../route";
import { createServiceRoleClient } from "../../../../../lib/supabase/serviceRole";
import { sendEmail } from "../../../../../lib/services/email";
import { getBookingById } from "../../../../../lib/services/bookings";
import { getCourtDisplayInfo } from "../../../../../lib/services/courts";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/supabase/serviceRole", () => ({ createServiceRoleClient: jest.fn() }));
jest.mock("../../../../../lib/services/email", () => ({ sendEmail: jest.fn() }));
jest.mock("../../../../../lib/services/bookings", () => ({ getBookingById: jest.fn() }));
jest.mock("../../../../../lib/services/courts", () => ({ getCourtDisplayInfo: jest.fn() }));
// calculateAmountPaid, formatVenueRange, isCreditOnly are pure — left real.

const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockGetBookingById = getBookingById as jest.MockedFunction<typeof getBookingById>;
const mockGetCourtDisplayInfo = getCourtDisplayInfo as jest.MockedFunction<typeof getCourtDisplayInfo>;

const SECRET = "test-webhook-secret";
const ORIGINAL_ENV = process.env;

function fakeRequest(body: unknown, secret: string | null = SECRET) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-webhook-secret", secret);
  return new Request("https://air-rally.com/api/webhooks/notification-created", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function mockGetUserById(result: { email: string } | null, emailNotificationsEnabled = true) {
  mockCreateServiceRoleClient.mockReturnValue({
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue(
          result ? { data: { user: { email: result.email } }, error: null } : { data: { user: null }, error: new Error("not found") }
        ),
      },
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: { email_notifications_enabled: emailNotificationsEnabled }, error: null }),
        }),
      }),
    }),
  } as never);
}

const INSERT_PAYLOAD = {
  type: "INSERT",
  table: "notifications",
  schema: "public",
  record: {
    id: "notif-1",
    user_id: "user-1",
    type: "credits_added",
    title: "Credits added",
    message: "₱400.00 in credits have been added to your account.",
    link_url: null,
  },
};

const BOOKING_CONFIRMED_PAYLOAD = {
  ...INSERT_PAYLOAD,
  record: {
    ...INSERT_PAYLOAD.record,
    type: "booking_confirmed",
    title: "Booking confirmed",
    message: "Your booking (confirmation #ABCD1234) is confirmed.",
    link_url: "/bookings/11111111-1111-4111-8111-111111111111/confirmation",
  },
};

const RECEIPT_BOOKING = {
  id: "11111111-1111-4111-8111-111111111111",
  court_id: "court-1",
  confirmation_code: "ABCD1234",
  price_amount: 50000,
  processing_fee_amount: 757,
  credit_amount_applied: 0,
  currency: "PHP",
  payment_provider: "paymongo",
  start_time: "2026-08-21T00:00:00Z",
  end_time: "2026-08-21T01:00:00Z",
};

const RECEIPT_DISPLAY = {
  courtName: "Court 2 — Riverside",
  venueName: "AIR/Rally Virtual Court",
  venueId: "venue-1",
  venueTimezone: "Asia/Manila",
  venuePaymongoAccountId: null,
  venuePaymongoActivationStatus: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SUPABASE_DB_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: "https://air-rally.com" };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/webhooks/notification-created", () => {
  it("rejects a request with no secret configured server-side", async () => {
    delete process.env.SUPABASE_DB_WEBHOOK_SECRET;
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    expect(response.status).toBe(500);
  });

  it("rejects a request with a missing or wrong secret", async () => {
    const response = await POST(fakeRequest(INSERT_PAYLOAD, "wrong"));
    expect(response.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores an event that isn't an INSERT on notifications", async () => {
    const response = await POST(fakeRequest({ ...INSERT_PAYLOAD, type: "UPDATE" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ignored: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("looks up the recipient's email and sends, routing through notificationHref for the link", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(true);

    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: true });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "player@example.test",
        subject: "Credits added",
        // credits_added has no link_url, so it falls back to TYPE_ROUTES —
        // the exact fix this PR made routes it to /profile/credits, not /profile.
        html: expect.stringContaining("https://air-rally.com/profile/credits"),
      })
    );
  });

  it("prefers the notification's own link_url over the type-based fallback", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(true);

    await POST(fakeRequest({ ...INSERT_PAYLOAD, record: { ...INSERT_PAYLOAD.record, link_url: "/events/abc" } }));

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("https://air-rally.com/events/abc") }));
  });

  it("still returns 200 when the user has no email on file — never blocks on a mail failure", async () => {
    mockGetUserById(null);
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when sendEmail itself fails", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(false);
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
  });

  it("still returns 200 even when an unexpected error is thrown", async () => {
    mockCreateServiceRoleClient.mockImplementation(() => {
      throw new Error("boom");
    });
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
  });

  it("rejects malformed JSON", async () => {
    const headers = new Headers({ "x-webhook-secret": SECRET });
    const request = new Request("https://air-rally.com/api/webhooks/notification-created", { method: "POST", headers, body: "not json" });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  describe("email notification preference", () => {
    it("skips sending, but still acknowledges 200, when the recipient has opted out", async () => {
      mockGetUserById({ email: "player@example.test" }, false);
      const response = await POST(fakeRequest(INSERT_PAYLOAD));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ received: true, emailed: false, skipped: "opted_out" });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends when the preference is explicitly on", async () => {
      mockGetUserById({ email: "player@example.test" }, true);
      mockSendEmail.mockResolvedValue(true);
      await POST(fakeRequest(INSERT_PAYLOAD));
      expect(mockSendEmail).toHaveBeenCalled();
    });
  });

  describe("booking_confirmed receipt", () => {
    it("builds a real receipt — confirmation code, court, venue, date/time, amount paid — not the generic template", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockGetBookingById.mockResolvedValue(RECEIPT_BOOKING as never);
      mockGetCourtDisplayInfo.mockResolvedValue(RECEIPT_DISPLAY as never);
      mockSendEmail.mockResolvedValue(true);

      await POST(fakeRequest(BOOKING_CONFIRMED_PAYLOAD));

      expect(mockGetBookingById).toHaveBeenCalledWith(expect.anything(), "11111111-1111-4111-8111-111111111111");
      const html = mockSendEmail.mock.calls[0][0].html;
      expect(html).toContain("ABCD1234");
      expect(html).toContain("Court 2 — Riverside");
      expect(html).toContain("AIR/Rally Virtual Court");
      // calculateAmountPaid() is price + fee (50000 + 757 = 50757), NEVER
      // price alone — this is the exact "amount paid vs court price" trap
      // the rest of the app is careful about.
      expect(html).toContain("₱507.57");
      expect(html).toContain("Paid in full.");
      // Not the generic template's copy.
      expect(html).not.toContain("Open in AIR/Rally");
    });

    it("shows the credit-paid variant for a fully credit-covered booking", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockGetBookingById.mockResolvedValue({ ...RECEIPT_BOOKING, payment_provider: "air_rally_credit" } as never);
      mockGetCourtDisplayInfo.mockResolvedValue(RECEIPT_DISPLAY as never);
      mockSendEmail.mockResolvedValue(true);

      await POST(fakeRequest(BOOKING_CONFIRMED_PAYLOAD));

      expect(mockSendEmail.mock.calls[0][0].html).toContain("Paid with AIR/Rally Credits.");
    });

    it("falls back to the generic template when the booking can't be found", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockGetBookingById.mockResolvedValue(null);
      mockSendEmail.mockResolvedValue(true);

      await POST(fakeRequest(BOOKING_CONFIRMED_PAYLOAD));

      const html = mockSendEmail.mock.calls[0][0].html;
      expect(html).toContain("Booking confirmed");
      expect(html).toContain("Open in AIR/Rally");
    });

    it("falls back to the generic template when the court/venue lookup fails", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockGetBookingById.mockResolvedValue(RECEIPT_BOOKING as never);
      mockGetCourtDisplayInfo.mockResolvedValue(null);
      mockSendEmail.mockResolvedValue(true);

      await POST(fakeRequest(BOOKING_CONFIRMED_PAYLOAD));

      expect(mockSendEmail.mock.calls[0][0].html).toContain("Open in AIR/Rally");
    });

    it("falls back to the generic template when link_url doesn't match a booking confirmation URL", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockSendEmail.mockResolvedValue(true);

      await POST(fakeRequest({ ...BOOKING_CONFIRMED_PAYLOAD, record: { ...BOOKING_CONFIRMED_PAYLOAD.record, link_url: "/bookings" } }));

      expect(mockGetBookingById).not.toHaveBeenCalled();
      expect(mockSendEmail.mock.calls[0][0].html).toContain("Open in AIR/Rally");
    });

    it("never attempts a receipt for a non-booking_confirmed type, even with a matching-shaped link_url", async () => {
      mockGetUserById({ email: "player@example.test" });
      mockSendEmail.mockResolvedValue(true);

      await POST(
        fakeRequest({
          ...INSERT_PAYLOAD,
          record: { ...INSERT_PAYLOAD.record, link_url: "/bookings/11111111-1111-4111-8111-111111111111/confirmation" },
        })
      );

      expect(mockGetBookingById).not.toHaveBeenCalled();
    });
  });
});
