/**
 * @jest-environment node
 */
import { getVenueEarnings } from "../venueEarnings";

function fakeSupabase(courtsData: unknown[], bookingsData: unknown[], reschedulesData: unknown[] = []) {
  return {
    from: jest.fn((table: string) => {
      if (table === "courts") {
        return { select: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: courtsData, error: null }) })) };
      }
      if (table === "bookings") {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: bookingsData, error: null }) })),
          })),
        };
      }
      if (table === "booking_reschedules") {
        return { select: jest.fn(() => ({ or: jest.fn().mockResolvedValue({ data: reschedulesData, error: null }) })) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as never;
}

const BASE_BOOKING = {
  id: "booking-1",
  court_id: "court-1",
  user_id: "user-1",
  start_time: "2026-08-12T00:00:00Z",
  end_time: "2026-08-12T01:00:00Z",
  status: "confirmed",
  price_amount: 50000,
  currency: "PHP",
  confirmation_code: "ABCD1234",
  cancelled_at: null,
  cancelled_by: null,
  stripe_checkout_session_id: "cs_test_1",
  stripe_payment_intent_id: "pi_test_1",
  paid_at: "2026-08-10T00:00:00Z",
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
  booking_refunds: [],
};

describe("getVenueEarnings", () => {
  it("returns an empty summary when the venue has no courts", async () => {
    const result = await getVenueEarnings(fakeSupabase([], []), "venue-1");
    expect(result).toEqual({ currency: "PHP", grossConfirmed: 0, refunded: 0, splitVenueAmount: 0, rows: [] });
  });

  it("sums gross confirmed amounts and never counts a pending or cancelled booking toward it", async () => {
    const bookings = [
      { ...BASE_BOOKING, id: "b1", status: "confirmed", price_amount: 50000 },
      { ...BASE_BOOKING, id: "b2", status: "pending", price_amount: 20000 },
      { ...BASE_BOOKING, id: "b3", status: "cancelled", price_amount: 30000 },
    ];
    const result = await getVenueEarnings(fakeSupabase([{ id: "court-1", name: "Court A" }], bookings), "venue-1");
    expect(result.grossConfirmed).toBe(50000);
  });

  it("sums succeeded refunds only, ignoring pending/failed ones", async () => {
    const bookings = [
      {
        ...BASE_BOOKING,
        booking_refunds: [
          { id: "r1", status: "succeeded", amount: 10000 },
          { id: "r2", status: "failed", amount: 5000 },
          { id: "r3", status: "pending", amount: 5000 },
        ],
      },
    ];
    const result = await getVenueEarnings(fakeSupabase([{ id: "court-1", name: "Court A" }], bookings), "venue-1");
    expect(result.refunded).toBe(10000);
    expect(result.rows[0].refundedAmount).toBe(10000);
  });

  it("reports venueRefundAmount as null (not zero) when no succeeded refund has actually reported it — never fabricating a figure", async () => {
    const bookings = [{ ...BASE_BOOKING, booking_refunds: [{ id: "r1", status: "pending", amount: 10000, venue_refund_amount: null }] }];
    const result = await getVenueEarnings(fakeSupabase([{ id: "court-1", name: "Court A" }], bookings), "venue-1");
    expect(result.rows[0].venueRefundAmount).toBeNull();
  });

  it("sums venueRefundAmount only from succeeded refunds that actually reported it, verbatim from the stored value — never recomputed from the 5%/95% formula", async () => {
    const bookings = [
      {
        ...BASE_BOOKING,
        booking_refunds: [
          { id: "r1", status: "succeeded", amount: 53926, venue_refund_amount: 51230 },
          { id: "r2", status: "failed", amount: 100, venue_refund_amount: null },
        ],
      },
    ];
    const result = await getVenueEarnings(fakeSupabase([{ id: "court-1", name: "Court A" }], bookings), "venue-1");
    expect(result.rows[0].venueRefundAmount).toBe(51230);
  });

  it("sums venue_amount only where it was actually snapshotted (PayMongo split), leaving it at 0 for plain Stripe bookings", async () => {
    const bookings = [
      { ...BASE_BOOKING, id: "b1", venue_amount: null },
      { ...BASE_BOOKING, id: "b2", venue_amount: 47500 },
    ];
    const result = await getVenueEarnings(fakeSupabase([{ id: "court-1", name: "Court A" }], bookings), "venue-1");
    expect(result.splitVenueAmount).toBe(47500);
  });

  it("resolves the court name from the venue's own courts, not from an embed", async () => {
    const bookings = [{ ...BASE_BOOKING, court_id: "court-2" }];
    const result = await getVenueEarnings(
      fakeSupabase(
        [
          { id: "court-1", name: "Court A" },
          { id: "court-2", name: "Court B" },
        ],
        bookings
      ),
      "venue-1"
    );
    expect(result.rows[0].courtName).toBe("Court B");
  });
});
