/**
 * @jest-environment node
 */
import { refundBookingAction } from "../refund";
import { getServerClient } from "../auth";
import { getBookingById } from "../../services/bookings";
import { requestRefund, RefundError } from "../../services/refunds";
import type { Booking } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/bookings", () => ({ getBookingById: jest.fn() }));
jest.mock("../../services/refunds", () => {
  class RefundError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "RefundError";
    }
  }
  return { requestRefund: jest.fn(), RefundError };
});

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockGetBookingById = getBookingById as jest.MockedFunction<typeof getBookingById>;
const mockRequestRefund = requestRefund as jest.MockedFunction<typeof requestRefund>;

function fakeClient(user: { id: string } | null, role: string | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: "not found" } }) })) })),
    })),
  } as never;
}

const BOOKING = { id: "booking-1" } as Booking;

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockGetBookingById.mockReset();
  mockRequestRefund.mockReset();
});

describe("refundBookingAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null, null) });
    const result = await refundBookingAction("booking-1", 50000);
    expect(result.success).toBe(false);
    expect(mockRequestRefund).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller, never reaching the service layer", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }, "player") });
    const result = await refundBookingAction("booking-1", 50000);
    expect(result).toEqual({ success: false, error: "This area is admin-only." });
    expect(mockRequestRefund).not.toHaveBeenCalled();
  });

  it("rejects a venue-owner caller too — refunds are admin-only, not owner-accessible", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }, "venue_owner") });
    const result = await refundBookingAction("booking-1", 50000);
    expect(result.success).toBe(false);
    expect(mockRequestRefund).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the booking doesn't exist", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "admin-1" }, "admin") });
    mockGetBookingById.mockResolvedValue(null);
    const result = await refundBookingAction("booking-1", 50000);
    expect(result.success).toBe(false);
    expect(mockRequestRefund).not.toHaveBeenCalled();
  });

  it("calls requestRefund with the real authenticated admin id as initiatedBy — never client-supplied", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "admin-1" }, "admin") });
    mockGetBookingById.mockResolvedValue(BOOKING);
    mockRequestRefund.mockResolvedValue({ id: "refund-1", status: "succeeded" } as never);

    const result = await refundBookingAction("booking-1", 20000, "Customer requested");

    expect(result).toEqual({ success: true, data: { id: "refund-1", status: "succeeded" } });
    expect(mockRequestRefund).toHaveBeenCalledWith(expect.anything(), {
      booking: BOOKING,
      amount: 20000,
      reason: "Customer requested",
      initiatedBy: "admin-1",
    });
  });

  it("maps a typed RefundError to its own message rather than a generic one", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "admin-1" }, "admin") });
    mockGetBookingById.mockResolvedValue(BOOKING);
    mockRequestRefund.mockRejectedValue(new RefundError("amount_exceeds_refundable", "Only 5000 remains refundable."));

    const result = await refundBookingAction("booking-1", 50000);

    expect(result).toEqual({ success: false, error: "Only 5000 remains refundable." });
  });
});
