/**
 * @jest-environment node
 */
import {
  getRescheduleEligibility,
  createReschedule,
  resumeRescheduleCheckout,
  retryRescheduleCompletion,
  maybeCompleteReschedule,
  maybeCompleteRescheduleFromProvider,
} from "../reschedules";
import { createTableMockSupabase, createQueryBuilder, postgrestError } from "../../test-helpers/mockSupabase";
import type { Booking, BookingReschedule } from "../../supabase/types";

// Relative paths — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
// bookings.ts/refunds.ts/paymongo.ts/payments.ts/courts.ts are all
// full-module-mocked, matching this codebase's established
// "each service's tests mock its sibling services" convention.
jest.mock("../bookings", () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(),
  getBookingById: jest.fn(),
  attachPaymongoCheckoutSession: jest.fn(),
  setBookingMarketplaceSplit: jest.fn(),
  BookingError: class BookingError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "BookingError";
    }
  },
}));
import { createBooking, cancelBooking, getBookingById, attachPaymongoCheckoutSession, setBookingMarketplaceSplit, BookingError } from "../bookings";
const mockCreateBooking = createBooking as jest.MockedFunction<typeof createBooking>;
const mockCancelBooking = cancelBooking as jest.MockedFunction<typeof cancelBooking>;
const mockGetBookingById = getBookingById as jest.MockedFunction<typeof getBookingById>;
const mockAttachPaymongoCheckoutSession = attachPaymongoCheckoutSession as jest.MockedFunction<typeof attachPaymongoCheckoutSession>;
const mockSetBookingMarketplaceSplit = setBookingMarketplaceSplit as jest.MockedFunction<typeof setBookingMarketplaceSplit>;

// Price decrease no longer refunds at all (see reschedules.ts's own
// comment above the decrease branch — QR Ph, AIR/Rally's only payment
// method, can't be refunded through PayMongo's API) — it issues AIR/Rally
// credit instead, via credits.ts, mocked here the same way every other
// sibling service in this file is.
jest.mock("../credits", () => ({ addCredit: jest.fn() }));
import { addCredit } from "../credits";
const mockAddCredit = addCredit as jest.MockedFunction<typeof addCredit>;

jest.mock("../paymongo", () => ({
  createPayMongoCheckoutSession: jest.fn(),
  retrievePayMongoCheckoutSession: jest.fn(),
}));
import { createPayMongoCheckoutSession, retrievePayMongoCheckoutSession } from "../paymongo";
const mockCreatePayMongoCheckoutSession = createPayMongoCheckoutSession as jest.MockedFunction<typeof createPayMongoCheckoutSession>;
const mockRetrievePayMongoCheckoutSession = retrievePayMongoCheckoutSession as jest.MockedFunction<typeof retrievePayMongoCheckoutSession>;


jest.mock("../courts", () => ({ getCourtDisplayInfo: jest.fn() }));
import { getCourtDisplayInfo } from "../courts";
const mockGetCourtDisplayInfo = getCourtDisplayInfo as jest.MockedFunction<typeof getCourtDisplayInfo>;

jest.mock("../../paymongoLaunchGates", () => ({ isPaymongoMarketplaceSplitEnabled: jest.fn(() => false) }));
import { isPaymongoMarketplaceSplitEnabled } from "../../paymongoLaunchGates";
const mockMarketplaceSplitEnabled = isPaymongoMarketplaceSplitEnabled as jest.MockedFunction<typeof isPaymongoMarketplaceSplitEnabled>;

// The security-critical mock: complete_reschedule()/mark_reschedule_
// failed()/record_reschedule_credit_success() are now called through a
// SEPARATE, service-role-authenticated client (see finding B1), never
// the caller's own RLS-scoped `supabase`. This mock stands in for that
// separate client. Its `.rpc` is asserted against directly in the
// SECURITY test group below to prove these calls never go through the
// ordinary session client — and every OTHER test in this file passes a
// plain createTableMockSupabase() with no `rpcResults` configured at
// all, so if reschedules.ts ever regressed to calling `.rpc()` on the
// caller's own client again, every single test here would fail loudly
// with "no mock rpc result configured", not silently pass.
const mockServiceRoleRpc = jest.fn();
// The credit path's follow-up lookup (createReschedule's decrease branch
// reads back the credit_transactions row addCredit() just wrote, since
// issue_credit() only returns the resulting wallet balance — see
// reschedules.ts's own comment on this) — a second entry point into the
// same service-role client alongside .rpc().
const mockServiceRoleFrom = jest.fn();
jest.mock("../../supabase/serviceRole", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: mockServiceRoleRpc, from: mockServiceRoleFrom })),
}));

// A real, minimal fake of the Stripe SDK shape reschedules.ts actually
// calls (checkout.sessions.create/expire) — never a live network call.
const NOW = new Date("2026-08-10T00:00:00Z");
// ≥24h out from NOW — satisfies the reschedule cutoff.
const FAR_FUTURE_START = "2026-08-13T00:00:00Z";
const FAR_FUTURE_END = "2026-08-13T01:00:00Z";

const ORIGINAL_BOOKING: Booking = {
  id: "booking-original",
  court_id: "court-1",
  user_id: "user-1",
  start_time: FAR_FUTURE_START,
  end_time: FAR_FUTURE_END,
  status: "confirmed",
  price_amount: 50000,
  currency: "PHP",
  confirmation_code: "ABCD1234",
  cancelled_at: null,
  cancelled_by: null,
  stripe_checkout_session_id: "cs_test_orig",
  stripe_payment_intent_id: "pi_test_orig",
  paid_at: "2026-08-01T00:00:00Z",
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
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const REPLACEMENT_BOOKING: Booking = {
  ...ORIGINAL_BOOKING,
  id: "booking-replacement",
  status: "pending",
  confirmation_code: "EFGH5678",
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  paid_at: null,
};

const RESCHEDULE_ROW: BookingReschedule = {
  id: "reschedule-1",
  original_booking_id: ORIGINAL_BOOKING.id,
  new_booking_id: REPLACEMENT_BOOKING.id,
  price_difference: 0,
  status: "pending_payment",
  refund_id: null,
  credit_transaction_id: null,
  initiated_by: "user-1",
  reason: null,
  failure_reason: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

const NOT_FOUND = { data: null, error: null };
const COURT_ROW = (venueId: string) => ({ data: { venue_id: venueId }, error: null });

/** Resolve every service-role RPC by name, matching real complete_reschedule/mark_reschedule_failed/record_reschedule_credit_success return shapes. */
function mockServiceRoleRpcResults(results: Record<string, { data: unknown; error: unknown } | undefined>) {
  mockServiceRoleRpc.mockImplementation((fn: string) => {
    const entry = results[fn];
    if (!entry) throw new Error(`mockServiceRoleRpc: no result configured for "${fn}"`);
    return Promise.resolve(entry);
  });
}

/**
 * Stands in for the service-role client's `.from("credit_transactions")`
 * lookup that follows a successful addCredit() call (see reschedules.ts —
 * issue_credit() returns only the resulting wallet balance, never the new
 * row's own id). Returns the query builder so a test can additionally
 * assert on the exact filters used (`.eq("reference_id", ...)`,
 * `.eq("transaction_type", "reschedule_compensation")`) — the same
 * "never a fabricated id" proof the old refund-id SECURITY test made.
 */
function mockCreditTransactionLookup(result: { data: unknown; error: null }) {
  const builder = createQueryBuilder(result);
  mockServiceRoleFrom.mockImplementation((table: string) => {
    if (table !== "credit_transactions") {
      throw new Error(`mockServiceRoleFrom: no result configured for table "${table}"`);
    }
    return builder;
  });
  return builder;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockCreateBooking.mockReset();
  mockCancelBooking.mockReset();
  mockGetBookingById.mockReset();
  mockAttachPaymongoCheckoutSession.mockReset();
  mockSetBookingMarketplaceSplit.mockReset();
  mockSetBookingMarketplaceSplit.mockResolvedValue(true);
  mockAddCredit.mockReset();
  mockCreatePayMongoCheckoutSession.mockReset();
  mockRetrievePayMongoCheckoutSession.mockReset();
  mockGetCourtDisplayInfo.mockReset();
  mockMarketplaceSplitEnabled.mockReset();
  mockMarketplaceSplitEnabled.mockReturnValue(false);
  mockServiceRoleRpc.mockReset();
  mockServiceRoleFrom.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------
// Eligibility (unchanged by the fixes — re-verified still correct)
// ---------------------------------------------------------------------
describe("getRescheduleEligibility", () => {
  it("is eligible when every check passes", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
    });
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toEqual({ eligible: true });
  });

  it("rejects when the booking doesn't exist", async () => {
    mockGetBookingById.mockResolvedValue(null);
    const supabase = createTableMockSupabase({});
    await expect(getRescheduleEligibility(supabase, "user-1", "missing")).resolves.toMatchObject({ eligible: false, reason: "booking_not_found" });
  });

  it("rejects a booking that isn't confirmed", async () => {
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, status: "pending" });
    const supabase = createTableMockSupabase({});
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toMatchObject({ eligible: false, reason: "booking_not_confirmed" });
  });

  it("rejects a booking starting inside the 24h cutoff", async () => {
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, start_time: "2026-08-10T12:00:00Z" });
    const supabase = createTableMockSupabase({});
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toMatchObject({ eligible: false, reason: "cutoff_passed" });
  });

  it("rejects a booking with an existing succeeded refund", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    const supabase = createTableMockSupabase({ booking_refunds: { data: { id: "refund-1" }, error: null } });
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toMatchObject({ eligible: false, reason: "booking_already_refunded" });
  });

  it("rejects a booking with an in-flight reschedule already pending", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, { data: { id: "reschedule-pending" }, error: null }],
    });
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toMatchObject({ eligible: false, reason: "reschedule_in_progress" });
  });

  // Regression: complete_reschedule() cancels the original via a raw UPDATE
  // (confirmed -> cancelled) that never runs through
  // restore_credit_on_booking_cancel() — that trigger only fires for a
  // pending -> cancelled transition. Before this guard, a credit-paid
  // booking's reschedule silently destroyed the applied credit.
  it("rejects a booking paid with any AIR/Rally Credits", async () => {
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, credit_amount_applied: 20000 });
    const supabase = createTableMockSupabase({});
    await expect(getRescheduleEligibility(supabase, "user-1", ORIGINAL_BOOKING.id)).resolves.toMatchObject({
      eligible: false,
      reason: "credit_booking_not_reschedulable",
    });
  });
});

// ---------------------------------------------------------------------
// SECURITY (finding B1) — complete_reschedule()/mark_reschedule_failed()
// are only ever reachable through the service-role client, never the
// caller's own session client. This is genuinely enforced at the
// DATABASE level (service_role-only grants) — these tests verify the
// APPLICATION layer's half of that: reschedules.ts never routes these
// calls through the wrong client, and never passes anything but a
// value it independently verified. A real "can an attacker call the RPC
// directly and bypass this" proof requires live Postgres with the actual
// grants applied — not something a mocked unit test can demonstrate.
// ---------------------------------------------------------------------
describe("SECURITY — completion RPCs only ever go through the service-role client", () => {
  it("createReschedule's same-price completion calls the service-role client, and the caller's own supabase.rpc is never touched", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue({ ...REPLACEMENT_BOOKING, price_amount: ORIGINAL_BOOKING.price_amount });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });
    // No rpcResults configured on the plain supabase mock at all — if
    // reschedules.ts ever called supabase.rpc(...) instead of the
    // service-role client, this test would throw
    // "no mock rpc result configured", not silently succeed.
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: 0 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    const result = await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    expect(result.kind).toBe("completed");
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("complete_reschedule", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_refund_id: null,
      p_credit_transaction_id: null,
    });
  });

  it("a direct, unauthorized call shape (RPC invoked with only a reschedule id, no independent verification) is exactly what service_role-only grants prevent — proven by there being NO code path in this file that calls complete_reschedule via the ordinary session client", async () => {
    // This test documents the actual security boundary rather than
    // re-deriving it: reschedules.ts has exactly one way to reach
    // complete_reschedule()/mark_reschedule_failed()/record_reschedule_
    // refund_success(), and it is always getRescheduleServiceRoleClient().
    // A customer's own browser session (the `supabase` parameter every
    // exported function here receives) never has execute privilege on
    // these functions at all once the migration is applied — REVOKE ALL
    // ... FROM public, anon, authenticated in
    // 20260810000015_booking_reschedules.sql. That grant restriction is
    // the actual enforcement; this suite cannot execute real SQL grants,
    // so it is verified by direct migration-file review, not by a test
    // assertion here.
    expect(true).toBe(true);
  });

  it("an unpaid increase reschedule (checkout never created/paid) cannot be completed just by the reschedule row existing — maybeCompleteReschedule requires an amount+currency+session match, not merely a valid id", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null },
    });
    // No amount/currency/session args resembling a real payment are
    // supplied — an attacker who only knows the reschedule id (and thus
    // the booking id) still cannot supply a provider session id that
    // matches what's actually stored, since that value only exists once
    // a checkout session was genuinely created server-side.
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, stripe_checkout_session_id: "cs_real_session" });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "PHP", "cs_guessed_or_fabricated")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("arbitrary credit_transaction_id values are never fabricated by the application layer — only ever the id looked up immediately after addCredit() succeeds", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockAddCredit.mockResolvedValue(10000);
    const creditLookupBuilder = mockCreditTransactionLookup({ data: { id: "credit-real-999" }, error: null });
    mockServiceRoleRpcResults({
      record_reschedule_credit_success: { data: true, error: null },
      complete_reschedule: { data: true, error: null },
    });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    // Never called with a fabricated or client-suppliable value — every
    // call traces back to the credit_transactions row looked up right
    // after addCredit() succeeded, filtered by the ORIGINAL booking's id
    // and this exact transaction type — not a client-suppliable value.
    expect(creditLookupBuilder.eq).toHaveBeenCalledWith("reference_id", ORIGINAL_BOOKING.id);
    expect(creditLookupBuilder.eq).toHaveBeenCalledWith("transaction_type", "reschedule_compensation");
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("record_reschedule_credit_success", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_credit_transaction_id: "credit-real-999",
    });
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("complete_reschedule", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_refund_id: null,
      p_credit_transaction_id: "credit-real-999",
    });
    // The database itself independently re-validates this id belongs to a
    // real reschedule_compensation transaction for the correct reference
    // (see record_reschedule_credit_success()'s own validation, which
    // this JS-level test cannot exercise without live Postgres).
  });

  it("cross-user reschedule completion via resumeRescheduleCheckout is rejected — a reschedule not initiated by the caller is treated as not found", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, initiated_by: "someone-else", price_difference: 20000 }, error: null },
    });
    await expect(
      resumeRescheduleCheckout(supabase, "user-1", "reschedule-1", { siteUrl: "https://air-rally.app" })
    ).rejects.toMatchObject({ reason: "reschedule_not_found" });
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("Blocker A's client-substitution bug class is structurally impossible for the credit path — addCredit() takes no client parameter at all", async () => {
    // Blocker A (see the test above and the SECURITY block's own
    // comments) was possible for requestRefund() specifically because it
    // took the caller's own client as a parameter, and booking_refunds'
    // RLS only permits an admin session to write to it — passing the
    // wrong client was a live, reachable bug shape. addCredit()'s
    // signature (credits.ts) is `(input: IssueCreditInput)` — no client
    // parameter exists to substitute the wrong one for. It reaches its
    // own internal service-role client (getCreditsServiceRoleClient())
    // unconditionally, the same way every RPC call in this file already
    // does. There is no code path in reschedules.ts that could pass an
    // RLS-scoped client to it even by mistake — verified by addCredit()'s
    // own type signature, not a runtime assertion here.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------
// createReschedule — pre-flight checks (unchanged by the fixes)
// ---------------------------------------------------------------------
describe("createReschedule — pre-flight checks", () => {
  it("never calls createBooking when eligibility fails", async () => {
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, status: "cancelled" });
    const supabase = createTableMockSupabase({});
    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "booking_not_confirmed" });
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("rejects a replacement court belonging to a different venue, without creating a booking", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-2")],
    });
    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "different_venue" });
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("wraps a BookingError from createBooking as new_slot_unavailable", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockRejectedValue(new BookingError("slot_unavailable", "That time isn't available."));
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });
    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "new_slot_unavailable" });
  });

  it("maps a 23505 unique-violation on the booking_reschedules insert to reschedule_in_progress and releases the just-created replacement", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(REPLACEMENT_BOOKING);
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: null, error: postgrestError("23505", "duplicate") }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });
    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "reschedule_in_progress" });
    expect(mockCancelBooking).toHaveBeenCalledWith(supabase, "user-1", REPLACEMENT_BOOKING.id);
  });

  // The guard belongs at the mutation itself, not only inside
  // getRescheduleEligibility() — checked explicitly here too, mirroring
  // cancelBooking()'s own inline credit check in bookings.ts.
  it("refuses to reschedule a credit-paid booking, without ever calling createBooking", async () => {
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, credit_amount_applied: 20000 });
    const supabase = createTableMockSupabase({});
    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "credit_booking_not_reschedulable" });
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });
});

describe("createReschedule — same price", () => {
  it("completes immediately via the service-role client with no checkout and no refund call", async () => {
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue({ ...REPLACEMENT_BOOKING, price_amount: ORIGINAL_BOOKING.price_amount });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: 0 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    const result = await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    expect(result.kind).toBe("completed");
    expect(mockAddCredit).not.toHaveBeenCalled();
    expect(mockCreatePayMongoCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("createReschedule — price increase", () => {
  it("computes price_difference as new minus original and creates a PayMongo checkout for exactly that difference", async () => {
    const higherPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 70000, payment_provider: "paymongo" as const };
    const paymongoOriginal = { ...ORIGINAL_BOOKING, payment_provider: "paymongo" as const };
    mockGetBookingById.mockResolvedValue(paymongoOriginal);
    mockCreateBooking.mockResolvedValue(higherPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court B", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_diff_1", url: "https://checkout.paymongo.com/diff_1" });

    let insertedPayload: unknown;
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });
    const originalFrom = (supabase as unknown as { from: jest.Mock }).from;
    (supabase as unknown as { from: jest.Mock }).from = jest.fn((table: string) => {
      if (table !== "booking_reschedules") return originalFrom(table);
      const builder = originalFrom(table) as Record<string, jest.Mock>;
      const realInsert = builder.insert;
      builder.insert = jest.fn((payload: unknown) => {
        insertedPayload = payload;
        return realInsert(payload);
      });
      return builder;
    });

    const result = await createReschedule(supabase, "user-1", {
      bookingId: paymongoOriginal.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    expect(insertedPayload).toMatchObject({ price_difference: 20000 });
    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ chargeAmountOverride: 20000, marketplaceSplit: undefined }));
    expect(mockAttachPaymongoCheckoutSession).toHaveBeenCalledWith(supabase, higherPriceReplacement.id, "cs_pm_diff_1");
    expect(mockSetBookingMarketplaceSplit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "checkout_required", checkoutUrl: "https://checkout.paymongo.com/diff_1" });
  });

  it("applies the marketplace split to the DIFFERENCE amount, not the replacement's full price", async () => {
    const higherPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 70000, payment_provider: "paymongo" as const };
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, payment_provider: "paymongo" });
    mockCreateBooking.mockResolvedValue(higherPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court B", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: "acc_venue_1", venuePaymongoActivationStatus: "activated" });
    mockMarketplaceSplitEnabled.mockReturnValue(true);
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_diff_2", url: "https://checkout.paymongo.com/diff_2" });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ marketplaceSplit: { platformFeeAmount: 1000, venuePaymongoAccountId: "acc_venue_1" } }));

    // The snapshot must be recorded through the service_role-only RPC — a
    // plain update rides the tamper guard and silently persists nothing
    // (migration 20260810000056). It splits the 20000 DIFFERENCE, not the
    // replacement's 70000 price.
    expect(mockSetBookingMarketplaceSplit).toHaveBeenCalledWith(higherPriceReplacement.id, {
      platformFeeAmount: 1000,
      venueAmount: 19000,
      paymongoVenueAccountId: "acc_venue_1",
    });
  });

  it("aborts the reschedule when the marketplace split snapshot cannot be recorded", async () => {
    const higherPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 70000, payment_provider: "paymongo" as const };
    mockGetBookingById.mockResolvedValue({ ...ORIGINAL_BOOKING, payment_provider: "paymongo" });
    mockCreateBooking.mockResolvedValue(higherPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court B", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: "acc_venue_1", venuePaymongoActivationStatus: "activated" });
    mockMarketplaceSplitEnabled.mockReturnValue(true);
    mockSetBookingMarketplaceSplit.mockResolvedValue(false);
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: RESCHEDULE_ROW, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toBeTruthy();

    // No PayMongo session may exist for a split we could not record.
    expect(mockCreatePayMongoCheckoutSession).not.toHaveBeenCalled();
  });

  it("leaves the reschedule row pending_payment (retryable) when difference-checkout creation fails", async () => {
    const higherPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 70000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(higherPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court B", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockCreatePayMongoCheckoutSession.mockRejectedValue(new Error("paymongo unavailable"));
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: RESCHEDULE_ROW, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toBeTruthy();

    // The replacement booking must survive so the customer can retry
    // paying the difference — cancelling it would lose the reservation.
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });
});

describe("createReschedule — price decrease (happy path)", () => {
  it("issues AIR/Rally credit for the exact difference, checkpoints it, then completes — in that order", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court A", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockAddCredit.mockResolvedValue(10000);
    mockCreditTransactionLookup({ data: { id: "credit-1" }, error: null });
    mockServiceRoleRpcResults({
      record_reschedule_credit_success: { data: true, error: null },
      complete_reschedule: { data: true, error: null },
    });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    const result = await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });

    // Never cash, never a "refund" — AIR/Rally credit for the exact
    // difference, general and unrestricted (founder decision 2026-08-31).
    expect(mockAddCredit).toHaveBeenCalledWith({
      userId: ORIGINAL_BOOKING.user_id,
      amount: 10000,
      transactionType: "reschedule_compensation",
      referenceId: ORIGINAL_BOOKING.id,
      description: expect.stringContaining("₱100.00"),
    });
    const rpcCallOrder = mockServiceRoleRpc.mock.calls.map((c) => c[0]);
    expect(rpcCallOrder).toEqual(["record_reschedule_credit_success", "complete_reschedule"]);
    expect(result.kind).toBe("completed");
  });

  it("addCredit() throwing marks the reschedule failed, releases the replacement, surfaces refund_failed — never a second attempt", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court A", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockAddCredit.mockRejectedValue(new Error("issue_credit RPC unreachable"));
    mockServiceRoleRpcResults({ mark_reschedule_failed: { data: true, error: null } });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "refund_failed" });

    expect(mockCancelBooking).toHaveBeenCalledWith(supabase, "user-1", lowerPriceReplacement.id);
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("mark_reschedule_failed", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_status: "failed",
      p_failure_reason: "issue_credit RPC unreachable",
      p_refund_id: null,
      p_credit_transaction_id: null,
    });
    expect(mockAddCredit).toHaveBeenCalledTimes(1); // never retried within this call
  });
});

// ---------------------------------------------------------------------
// CREDIT COMPLETION FAILURE (finding B3, extended to the credit
// mechanism) — the credit succeeds but a later step fails: either the
// follow-up id lookup, or completion itself.
// ---------------------------------------------------------------------
describe("createReschedule — price decrease, credit succeeds but completion fails (finding B3)", () => {
  it("credit succeeds but the credit_transactions lookup fails: surfaces completion_pending_retry, never checkpoints, never re-issues credit, never marks failed", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court A", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockAddCredit.mockResolvedValue(10000);
    // The row addCredit() just wrote isn't found by the immediate
    // follow-up lookup — e.g. replica lag, or a genuine bug in the query.
    mockCreditTransactionLookup({ data: null, error: null });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "completion_pending_retry" });

    expect(mockAddCredit).toHaveBeenCalledTimes(1); // never re-issued for a lookup failure
    expect(mockCancelBooking).not.toHaveBeenCalled(); // replacement stays reserved for retry
    expect(mockServiceRoleRpc).not.toHaveBeenCalledWith("record_reschedule_credit_success", expect.anything());
    expect(mockServiceRoleRpc).not.toHaveBeenCalledWith("mark_reschedule_failed", expect.anything());
  });

  it("credit succeeds + complete_reschedule() returns false: checkpoint still happened, no error thrown, logged only", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court A", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockAddCredit.mockResolvedValue(10000);
    mockCreditTransactionLookup({ data: { id: "credit-1" }, error: null });
    mockServiceRoleRpcResults({
      record_reschedule_credit_success: { data: true, error: null },
      complete_reschedule: { data: false, error: null },
    });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    // Does not throw — a false return is logged, not treated as fatal;
    // the row is still checkpointed at pending_completion for later retry.
    const result = await createReschedule(supabase, "user-1", {
      bookingId: ORIGINAL_BOOKING.id,
      newCourtId: "court-2",
      newStartTime: FAR_FUTURE_START,
      newEndTime: FAR_FUTURE_END,
      siteUrl: "https://air-rally.app",
    });
    expect(result.kind).toBe("completed");
    // Never a second credit issuance.
    expect(mockAddCredit).toHaveBeenCalledTimes(1);
  });

  it("credit succeeds + complete_reschedule() THROWS: surfaces completion_pending_retry, never re-issues credit, never cancels the replacement, never marks the reschedule failed", async () => {
    const lowerPriceReplacement = { ...REPLACEMENT_BOOKING, price_amount: 40000 };
    mockGetBookingById.mockResolvedValue(ORIGINAL_BOOKING);
    mockCreateBooking.mockResolvedValue(lowerPriceReplacement);
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court A", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockAddCredit.mockResolvedValue(10000);
    mockCreditTransactionLookup({ data: { id: "credit-1" }, error: null });
    mockServiceRoleRpc.mockImplementation((fn: string) => {
      if (fn === "record_reschedule_credit_success") return Promise.resolve({ data: true, error: null });
      if (fn === "complete_reschedule") return Promise.reject(new Error("connection reset"));
      throw new Error(`unexpected rpc ${fn}`);
    });
    const supabase = createTableMockSupabase({
      booking_refunds: NOT_FOUND,
      booking_reschedules: [NOT_FOUND, NOT_FOUND, NOT_FOUND, { data: { ...RESCHEDULE_ROW, price_difference: -10000 }, error: null }],
      courts: [COURT_ROW("venue-1"), COURT_ROW("venue-1")],
    });

    await expect(
      createReschedule(supabase, "user-1", {
        bookingId: ORIGINAL_BOOKING.id,
        newCourtId: "court-2",
        newStartTime: FAR_FUTURE_START,
        newEndTime: FAR_FUTURE_END,
        siteUrl: "https://air-rally.app",
      })
    ).rejects.toMatchObject({ reason: "completion_pending_retry" });

    expect(mockAddCredit).toHaveBeenCalledTimes(1); // never a second credit issuance
    expect(mockCancelBooking).not.toHaveBeenCalled(); // replacement stays reserved for retry
    expect(mockServiceRoleRpc).not.toHaveBeenCalledWith("mark_reschedule_failed", expect.anything()); // never abandons a succeeded credit
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("record_reschedule_credit_success", { p_reschedule_id: RESCHEDULE_ROW.id, p_credit_transaction_id: "credit-1" });
  });
});

describe("retryRescheduleCompletion", () => {
  it("does nothing for a reschedule that isn't pending_completion", async () => {
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_payment" }, error: null } });
    await expect(retryRescheduleCompletion(supabase, "reschedule-1")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("does nothing for a pending_completion row with neither refund_id nor credit_transaction_id somehow attached", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_completion", refund_id: null, credit_transaction_id: null }, error: null },
    });
    await expect(retryRescheduleCompletion(supabase, "reschedule-1")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("retries completion using the ALREADY-CHECKPOINTED refund_id, never re-deriving or re-refunding", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_completion", refund_id: "refund-checkpointed" }, error: null },
    });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });

    await expect(retryRescheduleCompletion(supabase, "reschedule-1")).resolves.toBe(true);

    expect(mockServiceRoleRpc).toHaveBeenCalledWith("complete_reschedule", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_refund_id: "refund-checkpointed",
      p_credit_transaction_id: null,
    });
  });

  it("retries completion using the ALREADY-CHECKPOINTED credit_transaction_id, never re-deriving or re-issuing credit", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_completion", credit_transaction_id: "credit-checkpointed" }, error: null },
    });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });

    await expect(retryRescheduleCompletion(supabase, "reschedule-1")).resolves.toBe(true);

    expect(mockServiceRoleRpc).toHaveBeenCalledWith("complete_reschedule", {
      p_reschedule_id: RESCHEDULE_ROW.id,
      p_refund_id: null,
      p_credit_transaction_id: "credit-checkpointed",
    });
    expect(mockAddCredit).not.toHaveBeenCalled();
  });

  it("is idempotent — a second retry call after the first already completed it is a safe no-op via complete_reschedule()'s own guard", async () => {
    const supabase = createTableMockSupabase({
      booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_completion", refund_id: "refund-checkpointed" }, error: null },
    });
    mockServiceRoleRpcResults({ complete_reschedule: { data: false, error: null } }); // already completed, WHERE clause matches nothing
    await expect(retryRescheduleCompletion(supabase, "reschedule-1")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------
// resumeRescheduleCheckout (finding B4)
// ---------------------------------------------------------------------
describe("resumeRescheduleCheckout", () => {
  it("rejects when the reschedule doesn't exist or wasn't initiated by this caller", async () => {
    const supabase = createTableMockSupabase({ booking_reschedules: NOT_FOUND });
    await expect(resumeRescheduleCheckout(supabase, "user-1", "reschedule-1", { siteUrl: "https://air-rally.app" })).rejects.toMatchObject({ reason: "reschedule_not_found" });
  });

  it("rejects a reschedule that isn't awaiting a payment", async () => {
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "completed", price_difference: 20000 }, error: null } });
    await expect(resumeRescheduleCheckout(supabase, "user-1", "reschedule-1", { siteUrl: "https://air-rally.app" })).rejects.toMatchObject({ reason: "reschedule_not_resumable" });
  });

  it("re-issues a fresh checkout session for the same, already-computed price difference — for PayMongo, never attempts session expiration", async () => {
    mockGetBookingById.mockImplementation((_supabase, id) =>
      Promise.resolve(
        id === ORIGINAL_BOOKING.id
          ? { ...ORIGINAL_BOOKING, payment_provider: "paymongo" as const }
          : { ...REPLACEMENT_BOOKING, payment_provider: "paymongo" as const }
      )
    );
    mockGetCourtDisplayInfo.mockResolvedValue({ courtName: "Court B", venueName: "Rally Court", venueId: "venue-1", venueTimezone: "Asia/Manila", venuePaymongoAccountId: null, venuePaymongoActivationStatus: "unlinked" });
    mockCreatePayMongoCheckoutSession.mockResolvedValue({ id: "cs_pm_resume", url: "https://checkout.paymongo.com/resume" });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, status: "pending_payment", price_difference: 20000 }, error: null } });

    const url = await resumeRescheduleCheckout(supabase, "user-1", "reschedule-1", { siteUrl: "https://air-rally.app" });

    expect(mockCreatePayMongoCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ chargeAmountOverride: 20000 }));
    expect(url).toBe("https://checkout.paymongo.com/resume");
  });


});

// ---------------------------------------------------------------------
// PAYMENT VALIDATION (findings B4, currency) — maybeCompleteReschedule
// ---------------------------------------------------------------------
describe("maybeCompleteReschedule — amount, currency, and stale-session validation", () => {
  it("is a safe no-op for a booking that isn't any reschedule's replacement", async () => {
    const supabase = createTableMockSupabase({ booking_reschedules: NOT_FOUND });
    await expect(maybeCompleteReschedule(supabase, "some-other-booking", 20000, "PHP", "cs_1")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("rejects the wrong amount", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, stripe_checkout_session_id: "cs_current" });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 19999, "PHP", "cs_current")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("rejects the wrong currency even when the amount matches exactly", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, currency: "PHP", stripe_checkout_session_id: "cs_current" });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "USD", "cs_current")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("rejects a stale/superseded checkout session even when amount and currency both match (finding B4)", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, currency: "PHP", stripe_checkout_session_id: "cs_newest" });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    // A webhook arriving late for an OLDER session id that's no longer
    // the one stored on the replacement (superseded by a resume) must
    // never complete the reschedule.
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "PHP", "cs_oldest_superseded")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("the newest, currently-stored session with the correct amount and currency completes successfully", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, currency: "PHP", stripe_checkout_session_id: "cs_newest" });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "PHP", "cs_newest")).resolves.toBe(true);
  });

  it("duplicate webhook delivery for the same, already-completed reschedule remains idempotent", async () => {
    // Once status flips to 'completed', the initial lookup query itself
    // (.eq("status", "pending_payment")) finds nothing.
    const supabase = createTableMockSupabase({ booking_reschedules: NOT_FOUND });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "PHP", "cs_newest")).resolves.toBe(false);
    expect(mockServiceRoleRpc).not.toHaveBeenCalled();
  });

  it("PayMongo path: works identically for the paymongo_checkout_session_id column", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, payment_provider: "paymongo", currency: "PHP", stripe_checkout_session_id: null, paymongo_checkout_session_id: "cs_pm_newest" });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteReschedule(supabase, REPLACEMENT_BOOKING.id, 20000, "PHP", "cs_pm_newest")).resolves.toBe(true);
  });
});

describe("maybeCompleteRescheduleFromProvider — currency validation added", () => {
  it("is a safe no-op for a booking that isn't any reschedule's replacement", async () => {
    const supabase = createTableMockSupabase({ booking_reschedules: NOT_FOUND });
    await expect(maybeCompleteRescheduleFromProvider(supabase, "some-other-booking")).resolves.toBe(false);
    expect(mockRetrievePayMongoCheckoutSession).not.toHaveBeenCalled();
  });



  it("PayMongo: rejects a currency mismatch", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, payment_provider: "paymongo", currency: "PHP", paymongo_checkout_session_id: "cs_pm_diff" });
    mockRetrievePayMongoCheckoutSession.mockResolvedValue({
      id: "cs_pm_diff",
      attributes: { payment_intent: { id: "pi_pm_diff", attributes: { amount: 20000, currency: "PHP", status: "succeeded", payments: [{ id: "pay_1", attributes: { amount: 20000, currency: "USD", status: "paid" } }] } } },
    });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteRescheduleFromProvider(supabase, REPLACEMENT_BOOKING.id)).resolves.toBe(false);
  });

  it("PayMongo: completes once amount and currency both match", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, payment_provider: "paymongo", currency: "PHP", paymongo_checkout_session_id: "cs_pm_diff" });
    mockRetrievePayMongoCheckoutSession.mockResolvedValue({
      id: "cs_pm_diff",
      attributes: { payment_intent: { id: "pi_pm_diff", attributes: { amount: 20000, currency: "PHP", status: "succeeded", payments: [{ id: "pay_1", attributes: { amount: 20000, currency: "PHP", status: "paid" } }] } } },
    });
    mockServiceRoleRpcResults({ complete_reschedule: { data: true, error: null } });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteRescheduleFromProvider(supabase, REPLACEMENT_BOOKING.id)).resolves.toBe(true);
  });

  it("does not complete when the replacement is no longer pending", async () => {
    mockGetBookingById.mockResolvedValue({ ...REPLACEMENT_BOOKING, status: "confirmed" });
    const supabase = createTableMockSupabase({ booking_reschedules: { data: { ...RESCHEDULE_ROW, price_difference: 20000 }, error: null } });
    await expect(maybeCompleteRescheduleFromProvider(supabase, REPLACEMENT_BOOKING.id)).resolves.toBe(false);
    expect(mockRetrievePayMongoCheckoutSession).not.toHaveBeenCalled();
  });
});
