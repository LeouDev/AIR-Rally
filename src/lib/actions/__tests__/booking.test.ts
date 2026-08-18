/**
 * @jest-environment node
 */
import { cancelBookingAction, previewCancellationAction } from "../booking";
import { getServerClient } from "../auth";
import { cancelBooking, getBookingById, BookingError } from "../../services/bookings";
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
    cancelBooking: jest.fn(),
    getBookingById: jest.fn(),
    BookingError,
  };
});
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCancelBooking = cancelBooking as jest.MockedFunction<typeof cancelBooking>;
const mockGetBookingById = getBookingById as jest.MockedFunction<typeof getBookingById>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const BOOKING_ROW = { id: "booking-1", status: "confirmed" } as Booking;

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCancelBooking.mockReset();
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
