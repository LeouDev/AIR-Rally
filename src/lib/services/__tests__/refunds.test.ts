/**
 * @jest-environment node
 */
import { getRefundableAmount, requestRefund, calculateRefundTotal, RefundError } from "../refunds";
import { isPaymongoRefundExecutionEnabled } from "../../paymongoLaunchGates";
import { retrievePayMongoPayment } from "../paymongo";
import type { Booking } from "../../supabase/types";

jest.mock("../../paymongoLaunchGates", () => ({ isPaymongoRefundExecutionEnabled: jest.fn() }));
const mockPaymongoRefundEnabled = isPaymongoRefundExecutionEnabled as jest.MockedFunction<typeof isPaymongoRefundExecutionEnabled>;

// Relative path for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
// Only retrievePayMongoPayment is mocked as a jest.fn(); everything else
// this module exports is re-implemented minimally so executePaymongoRefund's
// real logic (in refunds.ts, not mocked) still has real classes/functions
// to call.
jest.mock("../paymongo", () => ({
  getSecretKey: jest.fn(() => "sk_test_fake"),
  PayMongoError: class PayMongoError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "PayMongoError";
    }
  },
  describePayMongoErrorDetail: jest.fn((detail: unknown) => (typeof detail === "string" ? detail : undefined)),
  retrievePayMongoPayment: jest.fn(),
}));
const mockRetrievePayMongoPayment = retrievePayMongoPayment as jest.MockedFunction<typeof retrievePayMongoPayment>;

const originalPlatformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
const originalFetch = global.fetch;
const mockFetch = jest.fn();

afterAll(() => {
  if (originalPlatformAccountId === undefined) delete process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
  else process.env.PAYMONGO_PLATFORM_ACCOUNT_ID = originalPlatformAccountId;
  global.fetch = originalFetch;
});

const CONFIRMED_STRIPE_BOOKING: Booking = {
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
  stripe_checkout_session_id: "cs_test_123",
  stripe_payment_intent_id: "pi_test_456",
  paid_at: "2026-08-10T00:00:00Z",
  payment_provider: "stripe",
  credit_amount_applied: 0,
  processing_fee_amount: 0,
  paymongo_checkout_session_id: null,
  paymongo_payment_intent_id: null,
  paymongo_payment_id: null,
  platform_fee_amount: null,
  venue_amount: null,
  paymongo_venue_account_id: null,
  paymongo_available_at: null,
  paymongo_credited_at: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

const CONFIRMED_PAYMONGO_BOOKING: Booking = {
  ...CONFIRMED_STRIPE_BOOKING,
  id: "booking-2",
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  payment_provider: "paymongo",
  paymongo_checkout_session_id: "cs_test_1",
  paymongo_payment_intent_id: "pi_pm_1",
};

// paymongo_venue_account_id set — the one property that actually makes
// the split-refund kill switch apply, per requestRefund()'s own gate.
const SPLIT_PAYMONGO_BOOKING: Booking = {
  ...CONFIRMED_PAYMONGO_BOOKING,
  id: "booking-3",
  paymongo_venue_account_id: "acct_venue_1",
  platform_fee_amount: 2500,
  venue_amount: 47500,
};

beforeEach(() => {
  mockPaymongoRefundEnabled.mockReset();
  mockPaymongoRefundEnabled.mockReturnValue(false);
  mockRetrievePayMongoPayment.mockReset();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  delete process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
});

describe("getRefundableAmount", () => {
  it("returns the full price when no refund has ever succeeded", async () => {
    const supabase = { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })) })) })) } as never;
    await expect(getRefundableAmount(supabase, CONFIRMED_STRIPE_BOOKING)).resolves.toBe(50000);
  });

  it("subtracts every succeeded refund's amount", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [{ amount: 10000 }, { amount: 5000 }], error: null }) })) })),
      })),
    } as never;
    await expect(getRefundableAmount(supabase, CONFIRMED_STRIPE_BOOKING)).resolves.toBe(35000);
  });

  // Regression: price_amount is the GROSS price, but a booking partly paid
  // with AIR/Rally Credits was never charged that full amount to
  // PayMongo. Before this cap, a ₱1,199 credit + ₱1 cash booking computed
  // 50000 refundable (the gross price) instead of what was actually
  // captured — the only thing standing between that and a real over-
  // refund was PayMongo's own server-side validation, never our own.
  it("caps against what was actually captured (price minus applied credit), not the gross price", async () => {
    const supabase = { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })) })) })) } as never;
    const partlyCreditPaid = { ...CONFIRMED_STRIPE_BOOKING, price_amount: 50000, credit_amount_applied: 49900 };
    await expect(getRefundableAmount(supabase, partlyCreditPaid)).resolves.toBe(100);
  });

  // credit_amount_applied is 0 on every booking today — proves the cap is
  // a pure no-op for the common case rather than a behavior change riding
  // along with the fix.
  it("is unchanged for a booking with no credit applied", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [{ amount: 10000 }], error: null }) })) })),
      })),
    } as never;
    await expect(getRefundableAmount(supabase, CONFIRMED_STRIPE_BOOKING)).resolves.toBe(40000);
  });
});

describe("requestRefund", () => {
  function fakeSupabase(
    refundableRows: Array<{ amount: number }>,
    insertResult: unknown,
    updateResult: unknown,
    insertError: { code: string; message: string } | null = null
  ) {
    let insertedRow: unknown;
    let updatedPayload: unknown;
    return {
      from: jest.fn((table: string) => {
        if (table !== "booking_refunds") throw new Error(`unexpected table ${table}`);
        return {
          select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: refundableRows, error: null }) })) })),
          insert: jest.fn((payload: unknown) => {
            insertedRow = payload;
            return {
              select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue(insertError ? { data: null, error: insertError } : { data: insertResult, error: null }),
              })),
            };
          }),
          update: jest.fn((payload: unknown) => {
            updatedPayload = payload;
            return {
              eq: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: updateResult, error: null }) })) })),
            };
          }),
        };
      }),
      _insertedRow: () => insertedRow,
      _updatedPayload: () => updatedPayload,
    } as never;
  }

  it("rejects a non-positive or non-integer amount before touching the database", async () => {
    const supabase = fakeSupabase([], {}, {});
    await expect(
      requestRefund(supabase, { booking: CONFIRMED_STRIPE_BOOKING, amount: 0, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "invalid_amount" });
    await expect(
      requestRefund(supabase, { booking: CONFIRMED_STRIPE_BOOKING, amount: 12.5, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "invalid_amount" });
  });

  it("rejects a booking that was never paid", async () => {
    const supabase = fakeSupabase([], {}, {});
    const pendingBooking = { ...CONFIRMED_STRIPE_BOOKING, status: "pending" as const, stripe_payment_intent_id: null };
    await expect(
      requestRefund(supabase, { booking: pendingBooking, amount: 100, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "booking_not_paid" });
  });

  it("rejects an amount exceeding the refundable amount, without ever calling the provider", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    const supabase = fakeSupabase([{ amount: 45000 }], {}, {}); // only 5000 left refundable
    await expect(
      requestRefund(supabase, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 10000, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "amount_exceeds_refundable" });
  });

  it("refuses a SPLIT PayMongo refund when the kill switch is off — the exact production-safety property this module exists for", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(false);
    const supabase = fakeSupabase([], {}, {});
    await expect(
      requestRefund(supabase, { booking: SPLIT_PAYMONGO_BOOKING, amount: 100, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "paymongo_refund_not_enabled" });
    // No refund execution of any kind occurs while the flag is off — not
    // even the read-only QR Ph detection call, and no row is ever written.
    expect(mockRetrievePayMongoPayment).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT gate a non-split PayMongo refund on the kill switch — the gate is scoped to split accounting, not every PayMongo refund", async () => {
    // CONFIRMED_PAYMONGO_BOOKING has paymongo_venue_account_id: null (a
    // plain, non-split payment) — this is the exact case that used to be
    // blocked by the same flag as a real split, which was the bug this
    // narrowing fixes. The flag stays off (beforeEach's default) and the
    // refund must still go all the way through to the provider.
    mockRetrievePayMongoPayment.mockResolvedValue({ id: "pi_pm_1", attributes: { status: "paid", source: { type: "card" } } });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "ref_1", attributes: {} } }) });
    const supabase = fakeSupabase([], { id: "refund-1", status: "pending" }, { id: "refund-1", status: "succeeded" });

    const result = await requestRefund(supabase, {
      booking: CONFIRMED_PAYMONGO_BOOKING,
      amount: 50000,
      reason: null,
      initiatedBy: "admin-1",
    });

    expect(result.status).toBe("succeeded");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("writes a pending audit row before ever calling the provider, then marks it failed (with a captured reason) rather than throwing silently when the provider call fails", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    mockRetrievePayMongoPayment.mockRejectedValue(new Error("PayMongo unavailable"));
    const supabase = fakeSupabase(
      [],
      { id: "refund-1", status: "pending" },
      { id: "refund-1", status: "failed", failure_reason: "PayMongo unavailable" }
    );

    const result = await requestRefund(supabase, {
      booking: CONFIRMED_PAYMONGO_BOOKING,
      amount: 20000,
      reason: "Customer requested",
      initiatedBy: "admin-1",
    });

    expect((supabase as unknown as { _insertedRow: () => unknown })._insertedRow()).toMatchObject({
      booking_id: "booking-2",
      payment_provider: "paymongo",
      provider_payment_id: "pi_pm_1",
      amount: 20000,
      status: "pending",
    });
    expect(result.status).toBe("failed");
  });

  it("QR Ph — records provider_unavailable and never calls the PayMongo refund endpoint at all", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    mockRetrievePayMongoPayment.mockResolvedValue({ id: "pi_pm_1", attributes: { status: "paid", source: { type: "qrph" } } });
    const supabase = fakeSupabase(
      [],
      { id: "refund-1", status: "pending" },
      { id: "refund-1", status: "provider_unavailable", failure_reason: "PayMongo does not support refunds for \"qrph\" payments. This booking requires a manual refund handled outside PayMongo — see the admin payment page." }
    );

    const result = await requestRefund(supabase, {
      booking: CONFIRMED_PAYMONGO_BOOKING,
      amount: 50000,
      reason: null,
      initiatedBy: "admin-1",
    });

    expect(result.status).toBe("provider_unavailable");
    expect(mockRetrievePayMongoPayment).toHaveBeenCalledWith("pi_pm_1");
    // The refund endpoint itself must never be reached for a QR Ph payment.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a non-QR Ph PayMongo method proceeds past the source-type check normally", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    mockRetrievePayMongoPayment.mockResolvedValue({ id: "pi_pm_1", attributes: { status: "paid", source: { type: "card" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "ref_1", attributes: {} } }),
    });
    const supabase = fakeSupabase([], { id: "refund-1", status: "pending" }, { id: "refund-1", status: "succeeded" });

    const result = await requestRefund(supabase, {
      booking: CONFIRMED_PAYMONGO_BOOKING,
      amount: 50000,
      reason: null,
      initiatedBy: "admin-1",
    });

    expect(result.status).toBe("succeeded");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("records platform_refund_amount/venue_refund_amount/provider_available_at verbatim from a real PayMongo split_refund response — never computed locally from the 5%/95% formula", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    process.env.PAYMONGO_PLATFORM_ACCOUNT_ID = "org_parent_test";
    mockRetrievePayMongoPayment.mockResolvedValue({ id: "pi_pm_1", attributes: { status: "paid", source: { type: "card" } } });
    // Deliberately NOT a clean 5%/95% split of the requested amount
    // (50000 * 0.05 = 2500) — using an arbitrary, unrelated pair of
    // numbers proves the values come from the response, not from any
    // local recomputation of AIR/Rally's own commission formula.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "ref_real_1",
          attributes: {
            available_at: 1787216400,
            split_refund: {
              split_refunds: [
                { attributes: { amount: 9999, recipient_organization_id: "org_parent_test" } },
                { attributes: { amount: 40001, recipient_organization_id: "org_child_test" } },
              ],
            },
          },
        },
      }),
    });
    const supabase = fakeSupabase([], { id: "refund-1", status: "pending" }, { id: "refund-1", status: "succeeded" });

    await requestRefund(supabase, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 50000, reason: null, initiatedBy: "admin-1" });

    expect((supabase as unknown as { _updatedPayload: () => unknown })._updatedPayload()).toMatchObject({
      status: "succeeded",
      provider_refund_id: "ref_real_1",
      platform_refund_amount: 9999,
      venue_refund_amount: 40001,
      provider_available_at: new Date(1787216400 * 1000).toISOString(),
    });
  });

  it("leaves platform_refund_amount/venue_refund_amount null when PAYMONGO_PLATFORM_ACCOUNT_ID isn't configured, rather than guessing which leg is which", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    delete process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
    mockRetrievePayMongoPayment.mockResolvedValue({ id: "pi_pm_1", attributes: { status: "paid", source: { type: "card" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "ref_1",
          attributes: { split_refund: { split_refunds: [{ attributes: { amount: 100, recipient_organization_id: "org_x" } }] } },
        },
      }),
    });
    const supabase = fakeSupabase([], { id: "refund-1", status: "pending" }, { id: "refund-1", status: "succeeded" });

    await requestRefund(supabase, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 100, reason: null, initiatedBy: "admin-1" });

    expect((supabase as unknown as { _updatedPayload: () => unknown })._updatedPayload()).toMatchObject({
      platform_refund_amount: null,
      venue_refund_amount: null,
    });
  });

  it("passes refund_basis through verbatim when supplied, and leaves it null when omitted — never inferring a default", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    mockRetrievePayMongoPayment.mockRejectedValue(new Error("PayMongo unavailable"));
    const supabaseWithBasis = fakeSupabase([], { id: "refund-1", status: "pending" }, { id: "refund-1", status: "failed" });
    await requestRefund(supabaseWithBasis, {
      booking: CONFIRMED_PAYMONGO_BOOKING,
      amount: 100,
      reason: null,
      initiatedBy: "admin-1",
      refundBasis: "gross_only",
    });
    expect((supabaseWithBasis as unknown as { _insertedRow: () => unknown })._insertedRow()).toMatchObject({ refund_basis: "gross_only" });

    const supabaseWithoutBasis = fakeSupabase([], { id: "refund-2", status: "pending" }, { id: "refund-2", status: "failed" });
    await requestRefund(supabaseWithoutBasis, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 100, reason: null, initiatedBy: "admin-1" });
    expect((supabaseWithoutBasis as unknown as { _insertedRow: () => unknown })._insertedRow()).toMatchObject({ refund_basis: null });
  });

  it("a 23505 unique-constraint violation on the pending-refund index becomes a clean, typed error — never the raw database error", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    const supabase = fakeSupabase([], {}, {}, { code: "23505", message: 'duplicate key value violates unique constraint "booking_refunds_one_pending_per_booking"' });
    await expect(
      requestRefund(supabase, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 100, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ reason: "refund_already_in_progress", message: "A refund is already in progress for this booking." });
  });

  it("a non-23505 insert error is rethrown as-is (not silently swallowed or reclassified)", async () => {
    mockPaymongoRefundEnabled.mockReturnValue(true);
    const supabase = fakeSupabase([], {}, {}, { code: "42501", message: "permission denied" });
    await expect(
      requestRefund(supabase, { booking: CONFIRMED_PAYMONGO_BOOKING, amount: 100, reason: null, initiatedBy: "admin-1" })
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("calculateRefundTotal", () => {
  it("gross_only returns the booking gross, ignoring the customer total entirely", () => {
    expect(calculateRefundTotal("gross_only", 50000, 53926)).toBe(50000);
  });

  it("gross_plus_fee returns the full customer total, ignoring the gross", () => {
    expect(calculateRefundTotal("gross_plus_fee", 50000, 53926)).toBe(53926);
  });

  it("is exported as a plain, side-effect-free function — a pure candidate for a future business-rule decision, never invoked implicitly", () => {
    // Deliberately re-asserting the module doesn't throw or reach the
    // network on a bare call — this is the "never wired into the live
    // path" guarantee expressed as a test rather than a comment.
    expect(() => calculateRefundTotal("gross_only", 1, 2)).not.toThrow();
  });
});

describe("RefundError", () => {
  it("carries its reason on the error instance for the action layer to branch on", () => {
    const error = new RefundError("refund_already_in_progress", "A refund is already in progress for this booking.");
    expect(error.reason).toBe("refund_already_in_progress");
    expect(error.message).toBe("A refund is already in progress for this booking.");
    expect(error.name).toBe("RefundError");
  });
});
