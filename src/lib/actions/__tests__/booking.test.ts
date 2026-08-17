/**
 * @jest-environment node
 */
import { createBookingAction, cancelBookingAction, previewCancellationAction } from "../booking";
import { getServerClient } from "../auth";
import { createBooking, cancelBooking, getBookingById, BookingError } from "../../services/bookings";
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
    getBookingById: jest.fn(),
    BookingError,
  };
});
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateBooking = createBooking as jest.MockedFunction<typeof createBooking>;
const mockCancelBooking = cancelBooking as jest.MockedFunction<typeof cancelBooking>;
const mockGetBookingById = getBookingById as jest.MockedFunction<typeof getBookingById>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const validCreate = {
  courtId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298",
  startTime: "2026-08-12T00:00:00Z",
  endTime: "2026-08-12T01:00:00Z",
};

const BOOKING_ROW = { id: "booking-1", status: "confirmed" } as Booking;

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreateBooking.mockReset();
  mockCancelBooking.mockReset();
});

describe("createBookingAction", () => {
  it("rejects invalid input before contacting Supabase", async () => {
    const result = await createBookingAction({ ...validCreate, courtId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createBookingAction(validCreate);
    expect(result).toEqual({ success: false, error: "Sign in to book a court." });
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("creates a booking for the authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockResolvedValue(BOOKING_ROW);

    const result = await createBookingAction(validCreate);

    expect(result).toEqual({ success: true, data: BOOKING_ROW });
    expect(mockCreateBooking).toHaveBeenCalledWith(expect.anything(), "user-1", {
      courtId: validCreate.courtId,
      startTime: validCreate.startTime,
      endTime: validCreate.endTime,
    });
  });

  it("surfaces a BookingError's own message directly, not a generic fallback", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockRejectedValue(new BookingError("slot_unavailable", "That time isn't available."));

    const result = await createBookingAction(validCreate);

    expect(result).toEqual({ success: false, error: "That time isn't available." });
  });

  it("falls back to the generic friendly-error mapper for a non-BookingError failure", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateBooking.mockRejectedValue(new Error("connection reset"));

    const result = await createBookingAction(validCreate);

    expect(result).toEqual({ success: false, error: "We couldn't create that booking." });
  });
});

describe("cancelBookingAction", () => {
  const validCancel = { bookingId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298" };

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await cancelBookingAction(validCancel);
    expect(result.success).toBe(false);
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });

  it("cancels a booking for the authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCancelBooking.mockResolvedValue({ booking: { ...BOOKING_ROW, status: "cancelled" } as Booking, credit: { amount: 0, eligible: false, reason: "This booking was never paid, so there is nothing to refund.", issued: false } });

    const result = await cancelBookingAction(validCancel);

    expect(result.success).toBe(true);
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", validCancel.bookingId);
  });

  it("surfaces a BookingError's own message for an ineligible cancellation", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCancelBooking.mockRejectedValue(
      new BookingError("cancellation_window_passed", "This booking has already started and can no longer be cancelled.")
    );

    const result = await cancelBookingAction(validCancel);

    expect(result).toEqual({
      success: false,
      error: "This booking has already started and can no longer be cancelled.",
    });
  });
});

const PREVIEW_ID = "9f1d6e2a-1c4b-4a7e-9d2f-3b8c5e6a7d10";

describe("previewCancellationAction — telling them BEFORE they commit", () => {
  beforeEach(() => {
    mockGetServerClient.mockResolvedValue({
      ok: true,
      client: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) } },
    } as never);
    mockGetBookingById.mockReset();
  });

  const FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const SOON = new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString();

  it("states full credit for a paid booking outside the cutoff", async () => {
    // ₱406.09 charged, ₱400.00 refundable — the fee is not returned.
    mockGetBookingById.mockResolvedValue({ ...BOOKING_ROW, user_id: "user-1", paid_at: "2026-08-18T00:00:00Z", price_amount: 40000, processing_fee_amount: 609, start_time: FUTURE } as never);

    const result = await previewCancellationAction({ bookingId: PREVIEW_ID });

    expect(result.success && result.data.eligible).toBe(true);
    expect(result.success && result.data.amount).toBe(40000);
  });

  it("states no credit inside the cutoff, with a reason worth showing", async () => {
    mockGetBookingById.mockResolvedValue({ ...BOOKING_ROW, user_id: "user-1", paid_at: "2026-08-18T00:00:00Z", price_amount: 40000, start_time: SOON } as never);

    const result = await previewCancellationAction({ bookingId: PREVIEW_ID });

    expect(result.success && result.data.eligible).toBe(false);
    // 48, not the 24 the design doc says — the reason why a component must
    // not reimplement this.
    expect(result.success && result.data.reason).toMatch(/48/);
  });

  it("says there is nothing to refund on an unpaid booking", async () => {
    mockGetBookingById.mockResolvedValue({ ...BOOKING_ROW, user_id: "user-1", paid_at: null, start_time: FUTURE } as never);

    const result = await previewCancellationAction({ bookingId: PREVIEW_ID });

    expect(result.success && result.data.eligible).toBe(false);
    expect(result.success && result.data.reason).toMatch(/hasn't been paid/i);
  });

  it("refuses to preview someone else's booking", async () => {
    // A preview leaks what they paid, so it carries the same ownership
    // rule as the cancellation itself.
    mockGetBookingById.mockResolvedValue({ ...BOOKING_ROW, user_id: "someone-else", paid_at: "2026-08-18T00:00:00Z", start_time: FUTURE } as never);

    const result = await previewCancellationAction({ bookingId: PREVIEW_ID });

    expect(result.success).toBe(false);
  });

  it("cancels nothing", async () => {
    mockGetBookingById.mockResolvedValue({ ...BOOKING_ROW, user_id: "user-1", paid_at: "2026-08-18T00:00:00Z", start_time: FUTURE } as never);

    await previewCancellationAction({ bookingId: PREVIEW_ID });

    expect(mockCancelBooking).not.toHaveBeenCalled();
  });
});
