/**
 * @jest-environment node
 */
import { cancelBooking } from "../bookings";
import { addCredit } from "../credits";
import type { Booking } from "../../supabase/types";

jest.mock("../credits", () => {
  const actual = jest.requireActual("../credits");
  return { ...actual, addCredit: jest.fn() };
});
jest.mock("../paymongo", () => ({ retrievePayMongoCheckoutSession: jest.fn() }));
jest.mock("../../errors", () => ({ logServerError: jest.fn() }));

const mockLedger = { data: [] as unknown[], error: null };
jest.mock("../../supabase/serviceRole", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => mockLedger }) }) }) }),
  }),
}));

const mockAddCredit = addCredit as jest.MockedFunction<typeof addCredit>;

/** A ₱406.09 charge: ₱400 court + ₱6.09 passed-on fee. Starts well outside the 48h cutoff. */
const PAID: Booking = {
  id: "booking-1",
  confirmation_code: "TESTCODE",
  user_id: "user-1",
  status: "confirmed",
  price_amount: 40000,
  processing_fee_amount: 609,
  credit_amount_applied: 0,
  paid_at: "2026-08-18T00:00:00Z",
  start_time: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
} as unknown as Booking;

/** Minimal client: returns `existing` from the read, and the cancelled row from the update. */
function client(existing: Booking) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...existing, status: "cancelled" }, error: null }) }) }) }),
    }),
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLedger.data = [];
  mockAddCredit.mockResolvedValue(40000);
});

describe("cancelBooking — compensation wiring", () => {
  it("issues credit for a paid booking cancelled outside the cutoff", async () => {
    // THE BUG THIS FIXES: four paid bookings were cancelled on production
    // well inside policy and the ledger stayed empty, because nothing ever
    // called issueCancellationCredit.
    const result = await cancelBooking(client(PAID), "user-1", "booking-1");

    expect(result.credit.issued).toBe(true);
    expect(result.credit.eligible).toBe(true);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", transactionType: "cancellation_compensation", referenceId: "booking-1" })
    );
  });

  it("credits the COURT PRICE, never the amount paid", async () => {
    // ₱406.09 was charged; ₱400.00 is refundable. The processing fee was
    // consumed by PayMongo. calculateAmountPaid() sits in the same module
    // and would return 40609 — which is exactly why this is asserted.
    await cancelBooking(client(PAID), "user-1", "booking-1");

    expect(mockAddCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 40000 }));
    expect(mockAddCredit).not.toHaveBeenCalledWith(expect.objectContaining({ amount: 40609 }));
  });

  it("issues nothing for an unpaid booking", async () => {
    // The common case by volume — abandoned checkouts, and the cleanup
    // cancel in lib/actions/checkout.ts when session creation fails.
    // Compensating these would mint credit for money that never moved.
    const unpaid = { ...PAID, paid_at: null, status: "pending" } as Booking;
    const result = await cancelBooking(client(unpaid), "user-1", "booking-1");

    expect(result.credit.issued).toBe(false);
    expect(result.credit.reason).toMatch(/never paid/i);
    expect(mockAddCredit).not.toHaveBeenCalled();
  });

  it("issues nothing inside the 48h window, and says why", async () => {
    const soon = { ...PAID, start_time: new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString() } as Booking;
    const result = await cancelBooking(client(soon), "user-1", "booking-1");

    expect(result.credit.issued).toBe(false);
    expect(result.credit.eligible).toBe(false);
    // The customer must be TOLD this, not left guessing — hence a reason.
    expect(result.credit.reason).toMatch(/48/);
    expect(mockAddCredit).not.toHaveBeenCalled();
  });

  it("compensates a venue cancellation in full even inside the cutoff", async () => {
    // Wiring only the customer path would strand exactly the people the
    // policy most protects: the cutoff applies ONLY to customer-caused
    // cancellations.
    const soon = { ...PAID, start_time: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString() } as Booking;
    const result = await cancelBooking(client(soon), "user-1", "booking-1", { cause: "venue" });

    expect(result.credit.issued).toBe(true);
    expect(mockAddCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 40000 }));
  });

  it("refuses to double-issue when compensation already exists", async () => {
    mockLedger.data = [{ id: "existing-row" }];
    const result = await cancelBooking(client(PAID), "user-1", "booking-1");

    expect(result.credit.issued).toBe(false);
    expect(mockAddCredit).not.toHaveBeenCalled();
  });

  it("still cancels the booking when issuing credit fails", async () => {
    // A credit failure must not leave the customer unable to cancel. The
    // gap is logged and reported as issued:false, recoverable by an admin
    // adjustment — better than an un-cancellable booking.
    mockAddCredit.mockRejectedValue(new Error("ledger unavailable"));
    const result = await cancelBooking(client(PAID), "user-1", "booking-1");

    expect(result.booking.status).toBe("cancelled");
    expect(result.credit.issued).toBe(false);
    expect(result.credit.eligible).toBe(true);
  });
});

describe("credit-paid bookings are final", () => {
  const CREDIT_PAID = { ...PAID, credit_amount_applied: 40000 } as Booking;

  it("refuses to cancel a CONFIRMED booking that used credit", async () => {
    // Credit is itself a refund instrument. Without this, a customer could
    // cancel for credit, rebook with it, cancel again — holding a balance
    // forever while taking and releasing real inventory each cycle.
    await expect(cancelBooking(client(CREDIT_PAID), "user-1", "booking-1")).rejects.toMatchObject({
      reason: "credit_booking_not_cancellable",
    });
    expect(mockAddCredit).not.toHaveBeenCalled();
  });

  it("refuses on ANY credit, not only a fully covered booking", async () => {
    const partial = { ...PAID, credit_amount_applied: 100 } as Booking;
    await expect(cancelBooking(client(partial), "user-1", "booking-1")).rejects.toMatchObject({
      reason: "credit_booking_not_cancellable",
    });
  });

  it("STILL cancels a PENDING booking that holds credit", async () => {
    // Load-bearing. lib/actions/checkout.ts cancels a just-created pending
    // booking when Checkout Session creation fails, and credit is applied
    // before that point. Refusing here would strand the customer's credit
    // on a dead booking. Migration 20260810000037 restores it on this path.
    const pendingWithCredit = { ...PAID, status: "pending", paid_at: null, credit_amount_applied: 40000 } as Booking;
    const result = await cancelBooking(client(pendingWithCredit), "user-1", "booking-1");

    expect(result.booking.status).toBe("cancelled");
    // The trigger returns the credit, not this code path.
    expect(mockAddCredit).not.toHaveBeenCalled();
  });
});
