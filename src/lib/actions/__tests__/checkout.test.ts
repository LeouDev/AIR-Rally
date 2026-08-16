/**
 * @jest-environment node
 */
import { createCheckoutSessionAction } from "../checkout";
import { getServerClient } from "../auth";
import { createBooking, cancelBooking, attachCheckoutSession, attachPaymongoCheckoutSession, BookingError } from "../../services/bookings";
import { createCheckoutSession, PaymentError } from "../../services/payments";
import { createPayMongoCheckoutSession, PayMongoError } from "../../services/paymongo";
import { getCourtDisplayInfo } from "../../services/courts";
import { getSiteUrl } from "../../site";
import type { Booking } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/bookings", () => {
  class BookingError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "BookingError";
    }
  }
  return {
    createBooking: jest.fn(),
    cancelBooking: jest.fn(),
    attachCheckoutSession: jest.fn(),
    attachPaymongoCheckoutSession: jest.fn(),
    BookingError,
  };
});
jest.mock("../../services/payments", () => {
  class PaymentError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "PaymentError";
    }
  }
  return {
    createCheckoutSession: jest.fn(),
    PaymentError,
  };
});
jest.mock("../../services/paymongo", () => {
  class PayMongoError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "PayMongoError";
    }
  }
  return {
    createPayMongoCheckoutSession: jest.fn(),
    PayMongoError,
  };
});
jest.mock("../../services/courts", () => ({ getCourtDisplayInfo: jest.fn() }));
jest.mock("../../site", () => ({ getSiteUrl: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateBooking = createBooking as jest.MockedFunction<typeof createBooking>;
const mockCancelBooking = cancelBooking as jest.MockedFunction<typeof cancelBooking>;
const mockAttachCheckoutSession = attachCheckoutSession as jest.MockedFunction<typeof attachCheckoutSession>;
const mockAttachPaymongoCheckoutSession = attachPaymongoCheckoutSession as jest.MockedFunction<typeof attachPaymongoCheckoutSession>;
const mockCreateCheckoutSession = createCheckoutSession as jest.MockedFunction<typeof createCheckoutSession>;
const mockCreatePayMongoCheckoutSession = createPayMongoCheckoutSession as jest.MockedFunction<typeof createPayMongoCheckoutSession>;
const mockGetCourtDisplayInfo = getCourtDisplayInfo as jest.MockedFunction<typeof getCourtDisplayInfo>;
const mockGetSiteUrl = getSiteUrl as jest.MockedFunction<typeof getSiteUrl>;

function fakeClient(user: { id: string; email?: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const validInput = {
  courtId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298",
  startTime: "2026-08-12T00:00:00Z",
  endTime: "2026-08-12T01:00:00Z",
};

const PENDING_BOOKING = {
  id: "booking-1",
  user_id: "user-1",
  price_amount: 50000,
  currency: "PHP",
  status: "pending",
} as Booking;

const originalActiveProvider = process.env.ACTIVE_PAYMENT_PROVIDER;

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreateBooking.mockReset();
  mockCancelBooking.mockReset();
  mockAttachCheckoutSession.mockReset();
  mockAttachPaymongoCheckoutSession.mockReset();
  mockCreateCheckoutSession.mockReset();
  mockCreatePayMongoCheckoutSession.mockReset();
  mockGetCourtDisplayInfo.mockReset();
  mockGetSiteUrl.mockReset();
  mockGetSiteUrl.mockResolvedValue("https://airrally.app");
  mockGetCourtDisplayInfo.mockResolvedValue({
    courtName: "Court 1",
    venueName: "Rizal Pickleball Club",
    venuePaymongoAccountId: null,
    venuePaymongoActivationStatus: "unlinked",
  });
  delete process.env.ACTIVE_PAYMENT_PROVIDER;
  delete process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED;
});

afterAll(() => {
  if (originalActiveProvider !== undefined) process.env.ACTIVE_PAYMENT_PROVIDER = originalActiveProvider;
});

describe("createCheckoutSessionAction", () => {
  it("rejects invalid input before contacting Supabase or Stripe", async () => {
    const result = await createCheckoutSessionAction({ ...validInput, courtId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createCheckoutSessionAction(validInput);
    expect(result).toEqual({ success: false, error: "Sign in to book a court." });
    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates a pending booking before ever calling Stripe — the double-booking-safe ordering", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } as never);

    await createCheckoutSessionAction(validInput);

    expect(mockCreateBooking).toHaveBeenCalledWith(expect.anything(), "user-1", {
      courtId: validInput.courtId,
      startTime: validInput.startTime,
      endTime: validInput.endTime,
      status: "pending",
    });
    const createBookingOrder = mockCreateBooking.mock.invocationCallOrder[0];
    const createCheckoutOrder = mockCreateCheckoutSession.mock.invocationCallOrder[0];
    expect(createBookingOrder).toBeLessThan(createCheckoutOrder);
  });

  it("charges Stripe exactly the pending booking's own stored price/currency, never anything client-supplied", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } as never);

    await createCheckoutSessionAction(validInput);

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ booking: PENDING_BOOKING, venueName: "Rizal Pickleball Club", courtName: "Court 1" })
    );
  });

  it("never calls Stripe when the slot is unavailable — zero Stripe calls, no pending booking left behind", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockRejectedValue(new BookingError("slot_unavailable", "That time isn't available."));

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: false, error: "That time isn't available." });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    // No booking id was ever produced, so there's nothing to cancel.
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });

  it("never calls Stripe when the insert loses the 23P01 concurrency race, surfaced as concurrent_conflict", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockRejectedValue(new BookingError("concurrent_conflict", "That time slot is no longer available."));

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: false, error: "That time slot is no longer available." });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("cancels the pending booking when Stripe Checkout Session creation fails", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockRejectedValue(new PaymentError("checkout_session_creation_failed", "We couldn't start checkout — please try again."));

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: false, error: "We couldn't start checkout — please try again." });
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });

  it("cancels the pending booking when Stripe returns a session with no url", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: null } as never);

    const result = await createCheckoutSessionAction(validInput);

    expect(result.success).toBe(false);
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
    expect(mockAttachCheckoutSession).not.toHaveBeenCalled();
  });

  it("attaches the session id to the pending booking and returns Stripe's redirect url on success", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } as never);

    const result = await createCheckoutSessionAction(validInput);

    expect(mockAttachCheckoutSession).toHaveBeenCalledWith(expect.anything(), "booking-1", "cs_1");
    expect(result).toEqual({ success: true, data: { url: "https://checkout.stripe.com/pay/cs_1" } });
  });

  it("still cancels the pending booking if attachCheckoutSession itself fails after a real session was created", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } as never);
    mockAttachCheckoutSession.mockRejectedValue(new Error("connection reset"));

    const result = await createCheckoutSessionAction(validInput);

    expect(result.success).toBe(false);
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });

  it("defaults to the Stripe path when ACTIVE_PAYMENT_PROVIDER is unset, never touching the PayMongo service", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreateCheckoutSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } as never);

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: true, data: { url: "https://checkout.stripe.com/pay/cs_1" } });
    expect(mockCreateCheckoutSession).toHaveBeenCalled();
    expect(mockCreatePayMongoCheckoutSession).not.toHaveBeenCalled();
    expect(mockAttachPaymongoCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses the PayMongo path when ACTIVE_PAYMENT_PROVIDER=paymongo, never touching the Stripe service", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_1", url: "https://checkout.paymongo.com/cs_pm_1" });

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: true, data: { url: "https://checkout.paymongo.com/cs_pm_1" } });
    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ booking: PENDING_BOOKING, venueName: "Rizal Pickleball Club", courtName: "Court 1" })
    );
    expect(mockAttachPaymongoCheckoutSession).toHaveBeenCalledWith(expect.anything(), "booking-1", "cs_pm_1", undefined);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    expect(mockAttachCheckoutSession).not.toHaveBeenCalled();
  });

  it("attaches a marketplace split, computed fresh from the booking's own price_amount, only when the venue is 'activated' AND the platform-wide kill switch is explicitly enabled", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED = "true";
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING); // price_amount: 50000
    mockGetCourtDisplayInfo.mockResolvedValue({
      courtName: "Court 1",
      venueName: "Rizal Pickleball Club",
      venuePaymongoAccountId: "org_venue_1",
      venuePaymongoActivationStatus: "activated",
    });
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_2", url: "https://checkout.paymongo.com/cs_pm_2" });

    await createCheckoutSessionAction(validInput);

    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceSplit: { platformFeeAmount: 2500, venuePaymongoAccountId: "org_venue_1" } })
    );
    expect(mockAttachPaymongoCheckoutSession).toHaveBeenCalledWith(expect.anything(), "booking-1", "cs_pm_2", {
      platformFeeAmount: 2500,
      venueAmount: 47500,
      paymongoVenueAccountId: "org_venue_1",
    });
  });

  it("never attaches a marketplace split when the platform-wide kill switch is off, even for a fully activated venue — the production-safety property lib/paymongoLaunchGates.ts exists for", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockGetCourtDisplayInfo.mockResolvedValue({
      courtName: "Court 1",
      venueName: "Rizal Pickleball Club",
      venuePaymongoAccountId: "org_venue_1",
      venuePaymongoActivationStatus: "activated",
    });
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_2b", url: "https://checkout.paymongo.com/cs_pm_2b" });

    await createCheckoutSessionAction(validInput);

    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ marketplaceSplit: undefined }));
    expect(mockAttachPaymongoCheckoutSession).toHaveBeenCalledWith(expect.anything(), "booking-1", "cs_pm_2b", undefined);
  });

  it.each(["unlinked", "pending", "under_review", "declined"] as const)(
    "falls back to the plain, non-split checkout when the venue's PayMongo status is '%s'",
    async (status) => {
      process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
      mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
      mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
      mockGetCourtDisplayInfo.mockResolvedValue({
        courtName: "Court 1",
        venueName: "Rizal Pickleball Club",
        venuePaymongoAccountId: status === "unlinked" ? null : "org_venue_1",
        venuePaymongoActivationStatus: status,
      });
      mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_3", url: "https://checkout.paymongo.com/cs_pm_3" });

      await createCheckoutSessionAction(validInput);

      expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ marketplaceSplit: undefined })
      );
      expect(mockAttachPaymongoCheckoutSession).toHaveBeenCalledWith(expect.anything(), "booking-1", "cs_pm_3", undefined);
    }
  );

  it("cancels the pending booking when PayMongo Checkout Session creation fails, same cleanup as the Stripe path", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockCreatePayMongoCheckoutSession.mockRejectedValue(
      new PayMongoError("checkout_session_creation_failed", "We couldn't start checkout — please try again.")
    );

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: false, error: "We couldn't start checkout — please try again." });
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });

  it("cancels the pending booking when a split-payment checkout creation fails (e.g. a silently disabled venue account), and never attaches a stale split snapshot", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(PENDING_BOOKING);
    mockGetCourtDisplayInfo.mockResolvedValue({
      courtName: "Court 1",
      venueName: "Rizal Pickleball Club",
      venuePaymongoAccountId: "org_venue_1",
      venuePaymongoActivationStatus: "activated",
    });
    mockCreatePayMongoCheckoutSession.mockRejectedValue(
      new PayMongoError("checkout_session_creation_failed", "We couldn't start checkout — please try again.")
    );

    const result = await createCheckoutSessionAction(validInput);

    expect(result).toEqual({ success: false, error: "We couldn't start checkout — please try again." });
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
    expect(mockAttachPaymongoCheckoutSession).not.toHaveBeenCalled();
  });
});
