/**
 * @jest-environment node
 */
import { listPaymentMonitoringRows, listVenuePaymentIssues } from "../adminPayments";

function fakeSupabase(bookingsData: unknown[], venuesData: unknown[] = []) {
  return {
    from: jest.fn((table: string) => {
      if (table === "bookings") {
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue({ data: bookingsData, error: null }),
            })),
          })),
        };
      }
      if (table === "venues") {
        return { select: jest.fn().mockResolvedValue({ data: venuesData, error: null }) };
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
  courts: { name: "Court A", venues: { name: "Rally Court" } },
  booking_refunds: [],
};

describe("listPaymentMonitoringRows", () => {
  it("maps a plain confirmed, unrefunded booking to lifecycleStatus 'confirmed' with no flags", async () => {
    const rows = await listPaymentMonitoringRows(fakeSupabase([BASE_BOOKING]));
    expect(rows).toEqual([
      expect.objectContaining({
        bookingId: "booking-1",
        lifecycleStatus: "confirmed",
        reconciliationFlags: [],
        venueName: "Rally Court",
        courtName: "Court A",
        refundedAmount: 0,
      }),
    ]);
  });

  it("classifies a fully refunded booking over a merely-cancelled one", async () => {
    const row = {
      ...BASE_BOOKING,
      status: "cancelled",
      booking_refunds: [{ id: "r1", status: "succeeded", amount: 50000 }],
    };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.lifecycleStatus).toBe("refunded");
  });

  it("classifies a partial refund distinctly from a full refund", async () => {
    const row = { ...BASE_BOOKING, booking_refunds: [{ id: "r1", status: "succeeded", amount: 10000 }] };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.lifecycleStatus).toBe("partially_refunded");
    expect(result.refundedAmount).toBe(10000);
  });

  it("flags a confirmed booking with no paid_at and no provider payment id", async () => {
    const row = { ...BASE_BOOKING, paid_at: null, stripe_payment_intent_id: null };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags).toEqual(
      expect.arrayContaining([
        "Confirmed booking has no paid_at timestamp.",
        "Confirmed booking has no provider payment id on record.",
      ])
    );
  });

  it("flags a fee/venue-amount mismatch against the booking price", async () => {
    const row = { ...BASE_BOOKING, platform_fee_amount: 2000, venue_amount: 47000 }; // sums to 49000, not 50000
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags).toContain("Platform fee + venue amount does not sum to the booking price.");
  });

  it("flags a failed refund attempt with no later successful one", async () => {
    const row = { ...BASE_BOOKING, booking_refunds: [{ id: "r1", status: "failed", amount: 10000 }] };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags).toContain("A refund attempt failed and no later attempt succeeded.");
  });

  it("does not flag a failed refund attempt once a later one succeeded", async () => {
    const row = {
      ...BASE_BOOKING,
      booking_refunds: [
        { id: "r1", status: "failed", amount: 10000 },
        { id: "r2", status: "succeeded", amount: 10000 },
      ],
    };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags).not.toContain("A refund attempt failed and no later attempt succeeded.");
  });

  it("flags a provider_unavailable refund as needing manual handling", async () => {
    const row = {
      ...BASE_BOOKING,
      booking_refunds: [{ id: "r1", status: "provider_unavailable", amount: 50000, failure_reason: "qrph not supported" }],
    };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags).toContain("A refund cannot be processed through the payment provider — requires manual handling.");
  });

  it("surfaces every new refund field verbatim, including nulls, never fabricating a value", async () => {
    const row = {
      ...BASE_BOOKING,
      booking_refunds: [
        {
          id: "r1",
          status: "succeeded",
          amount: 53926,
          refund_basis: "gross_plus_fee",
          platform_refund_amount: 2696,
          venue_refund_amount: 51230,
          provider_available_at: "2026-08-20T09:00:00.000Z",
          failure_reason: null,
          created_at: "2026-08-16T00:00:00Z",
        },
      ],
    };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.refunds).toEqual([
      {
        id: "r1",
        status: "succeeded",
        amount: 53926,
        refundBasis: "gross_plus_fee",
        platformRefundAmount: 2696,
        venueRefundAmount: 51230,
        providerAvailableAt: "2026-08-20T09:00:00.000Z",
        failureReason: null,
        createdAt: "2026-08-16T00:00:00Z",
      },
    ]);
  });

  it("leaves refund detail fields null when a refund hasn't actually reported them yet (e.g. PAYMONGO_REFUND_EXECUTION_ENABLED=false today)", async () => {
    const row = {
      ...BASE_BOOKING,
      booking_refunds: [
        { id: "r1", status: "pending", amount: 50000, refund_basis: null, platform_refund_amount: null, venue_refund_amount: null, provider_available_at: null, failure_reason: null, created_at: "2026-08-16T00:00:00Z" },
      ],
    };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.refunds[0]).toMatchObject({
      refundBasis: null,
      platformRefundAmount: null,
      venueRefundAmount: null,
      providerAvailableAt: null,
    });
  });

  it("flags a pending booking older than 24h as a likely abandoned checkout", async () => {
    const row = { ...BASE_BOOKING, status: "pending", paid_at: null, created_at: "2020-01-01T00:00:00Z" };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags.some((f) => f.includes("abandoned checkout"))).toBe(true);
  });

  it("does not flag a freshly created pending booking", async () => {
    const row = { ...BASE_BOOKING, status: "pending", paid_at: null, created_at: new Date().toISOString() };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.reconciliationFlags.some((f) => f.includes("abandoned checkout"))).toBe(false);
  });

  it("falls back to generic names when the court/venue embed is missing", async () => {
    const row = { ...BASE_BOOKING, courts: null };
    const [result] = await listPaymentMonitoringRows(fakeSupabase([row]));
    expect(result.venueName).toBe("Venue");
    expect(result.courtName).toBe("Court");
  });
});

describe("listVenuePaymentIssues", () => {
  it("flags pending_review and suspended venues but not draft or active ones", async () => {
    const venues = [
      { id: "v1", name: "Draft Venue", status: "draft", paymongo_activation_status: "unlinked", paymongo_declined_reason: null },
      { id: "v2", name: "Review Venue", status: "pending_review", paymongo_activation_status: "unlinked", paymongo_declined_reason: null },
      { id: "v3", name: "Suspended Venue", status: "suspended", paymongo_activation_status: "unlinked", paymongo_declined_reason: null },
      { id: "v4", name: "Active Venue", status: "active", paymongo_activation_status: "unlinked", paymongo_declined_reason: null },
    ];
    const issues = await listVenuePaymentIssues(fakeSupabase([], venues));
    expect(issues.map((i) => i.venueId)).toEqual(["v2", "v3"]);
  });

  it("flags a mid-onboarding or declined PayMongo venue, including the decline reason when present", async () => {
    const venues = [
      { id: "v1", name: "Pending PM", status: "active", paymongo_activation_status: "pending", paymongo_declined_reason: null },
      { id: "v2", name: "Declined PM", status: "active", paymongo_activation_status: "declined", paymongo_declined_reason: "Incomplete KYC" },
      { id: "v3", name: "Activated PM", status: "active", paymongo_activation_status: "activated", paymongo_declined_reason: null },
    ];
    const issues = await listVenuePaymentIssues(fakeSupabase([], venues));
    expect(issues).toHaveLength(2);
    expect(issues.find((i) => i.venueId === "v2")?.detail).toContain("Incomplete KYC");
  });
});
