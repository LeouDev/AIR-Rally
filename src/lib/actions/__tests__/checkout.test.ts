/**
 * @jest-environment node
 */
import { createCheckoutSessionAction } from "../checkout";
import { getServerClient } from "../auth";
import { createBooking, cancelBooking, attachPaymongoCheckoutSession, setBookingProcessingFee } from "../../services/bookings";
import { createPayMongoCheckoutSession } from "../../services/paymongo";
import { getUserCreditBalance, applyCreditToBooking, confirmCreditOnlyBooking } from "../../services/credits";
import { getCourtDisplayInfo } from "../../services/courts";
import type { Booking } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/bookings", () => {
  const actual = jest.requireActual("../../services/bookings");
  return {
    ...actual,
    createBooking: jest.fn(),
    cancelBooking: jest.fn(),
    attachPaymongoCheckoutSession: jest.fn(),
    setBookingProcessingFee: jest.fn(),
  };
});
jest.mock("../../services/paymongo", () => {
  const actual = jest.requireActual("../../services/paymongo");
  return { ...actual, createPayMongoCheckoutSession: jest.fn() };
});
jest.mock("../../services/credits", () => {
  const actual = jest.requireActual("../../services/credits");
  return {
    ...actual,
    getUserCreditBalance: jest.fn(),
    applyCreditToBooking: jest.fn(),
    confirmCreditOnlyBooking: jest.fn(),
  };
});
jest.mock("../../services/courts", () => ({ getCourtDisplayInfo: jest.fn() }));
jest.mock("../../site", () => ({ getSiteUrl: jest.fn().mockResolvedValue("https://air-rally.test") }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateBooking = createBooking as jest.MockedFunction<typeof createBooking>;
const mockCancelBooking = cancelBooking as jest.MockedFunction<typeof cancelBooking>;
const mockAttachSession = attachPaymongoCheckoutSession as jest.MockedFunction<typeof attachPaymongoCheckoutSession>;
const mockSetProcessingFee = setBookingProcessingFee as jest.MockedFunction<typeof setBookingProcessingFee>;
const mockCreateSession = createPayMongoCheckoutSession as jest.MockedFunction<typeof createPayMongoCheckoutSession>;
const mockGetBalance = getUserCreditBalance as jest.MockedFunction<typeof getUserCreditBalance>;
const mockApplyCredit = applyCreditToBooking as jest.MockedFunction<typeof applyCreditToBooking>;
const mockConfirmCreditOnly = confirmCreditOnlyBooking as jest.MockedFunction<typeof confirmCreditOnlyBooking>;
const mockGetCourtDisplay = getCourtDisplayInfo as jest.MockedFunction<typeof getCourtDisplayInfo>;

/** A ₱500 booking, one hour, far enough ahead to satisfy every lead-time rule. */
const BOOKING: Booking = {
  id: "booking-1",
  court_id: "court-1",
  user_id: "user-1",
  start_time: "2026-09-01T02:00:00Z",
  end_time: "2026-09-01T03:00:00Z",
  status: "pending",
  price_amount: 50000,
  currency: "PHP",
  confirmation_code: "ABCD1234",
  cancelled_at: null,
  cancelled_by: null,
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  paid_at: null,
  payment_provider: "paymongo",
  credit_amount_applied: 0,
  processing_fee_amount: 0,
  paymongo_checkout_session_id: null,
  paymongo_payment_intent_id: null,
  platform_fee_amount: null,
  venue_amount: null,
  paymongo_venue_account_id: null,
  paymongo_available_at: null,
  paymongo_credited_at: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

// createBookingSchema requires a real UUID for courtId.
const COURT_UUID = "11111111-1111-4111-8111-111111111111";
const VALUES = { courtId: COURT_UUID, startTime: BOOKING.start_time, endTime: BOOKING.end_time };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerClient.mockResolvedValue({
    ok: true,
    client: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) } },
  } as never);
  mockCreateBooking.mockResolvedValue(BOOKING);
  mockGetCourtDisplay.mockResolvedValue({
    venueName: "Rizal Pickleball Club",
    courtName: "Court 1",
    venuePaymongoActivationStatus: null,
    venuePaymongoAccountId: null,
  } as never);
  mockCreateSession.mockResolvedValue({ id: "cs_test_1", url: "https://paymongo.test/cs_test_1" } as never);
  mockApplyCredit.mockResolvedValue(0);
  mockSetProcessingFee.mockResolvedValue(true);
  mockConfirmCreditOnly.mockResolvedValue(true);
});

/** The amount actually sent to PayMongo for this call. */
function chargedAmount(): number | undefined {
  return mockCreateSession.mock.calls[0][0].chargeAmountOverride;
}

describe("createCheckoutSessionAction — credits", () => {
  // 1. Full PayMongo payment (no credits)
  it("charges the full price through PayMongo when the wallet is empty", async () => {
    mockGetBalance.mockResolvedValue({ balance: 0 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result).toEqual({
      success: true,
      data: { url: "https://paymongo.test/cs_test_1", bookingId: "booking-1", creditApplied: 0, amountDue: 50000 },
    });
    expect(mockApplyCredit).not.toHaveBeenCalled();
    expect(chargedAmount()).toBe(50000);
    expect(mockAttachSession).toHaveBeenCalled();
  });

  // 2. Partial credits + PayMongo payment
  it("applies partial credit and charges PayMongo only the remainder", async () => {
    mockGetBalance.mockResolvedValue({ balance: 30000 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      url: "https://paymongo.test/cs_test_1",
      bookingId: "booking-1",
      creditApplied: 30000,
      amountDue: 20000,
    });
    expect(mockApplyCredit).toHaveBeenCalledWith({ userId: "user-1", bookingId: "booking-1", amount: 30000 });
    // ₱500 booking - ₱300 credit = ₱200 to PayMongo, never the full price.
    expect(chargedAmount()).toBe(20000);
  });

  // 3. Full credits, no PayMongo
  it("skips PayMongo entirely when credit covers the whole booking", async () => {
    mockGetBalance.mockResolvedValue({ balance: 50000 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success && result.data).toEqual({
      url: "https://air-rally.test/bookings/booking-1/confirmation",
      bookingId: "booking-1",
      creditApplied: 50000,
      amountDue: 0,
    });
    expect(mockApplyCredit).toHaveBeenCalledWith({ userId: "user-1", bookingId: "booking-1", amount: 50000 });
    expect(mockConfirmCreditOnly).toHaveBeenCalledWith({ userId: "user-1", bookingId: "booking-1" });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAttachSession).not.toHaveBeenCalled();
  });

  it("never spends more credit than the booking costs", async () => {
    mockGetBalance.mockResolvedValue({ balance: 90000 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(mockApplyCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000 }));
    expect(result.success && result.data.amountDue).toBe(0);
  });

  // 4. Insufficient credits — the wallet can't cover it, so the rest is
  // charged. "Insufficient" is never an error at checkout; it just means a
  // smaller discount.
  it("treats a wallet smaller than the price as a partial payment, not a failure", async () => {
    mockGetBalance.mockResolvedValue({ balance: 100 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    expect(chargedAmount()).toBe(49900);
  });

  // A balance that vanishes between the read and the spend (the concurrent
  // case) surfaces as a throw from the locked RPC. The booking must be
  // released, not left pending and unpayable.
  it("releases the booking when the credit spend loses a concurrent race", async () => {
    mockGetBalance.mockResolvedValue({ balance: 30000 });
    mockApplyCredit.mockRejectedValue(new Error("Insufficient AIR/Rally Credits."));

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(false);
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // 5. Concurrent checkout attempts: two calls against one wallet. The
  // second one's spend is rejected by the RPC's row lock, so only one
  // booking survives — the wallet is never overdrawn.
  it("lets only one of two concurrent checkouts spend the same credit", async () => {
    mockGetBalance.mockResolvedValue({ balance: 50000 });
    mockCreateBooking.mockResolvedValueOnce(BOOKING).mockResolvedValueOnce({ ...BOOKING, id: "booking-2" });
    mockApplyCredit.mockResolvedValueOnce(0).mockRejectedValueOnce(new Error("Insufficient AIR/Rally Credits."));

    const [first, second] = await Promise.all([createCheckoutSessionAction(VALUES), createCheckoutSessionAction(VALUES)]);

    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(mockApplyCredit).toHaveBeenCalledTimes(2);
    expect(mockCancelBooking).toHaveBeenCalledTimes(1);
  });

  it("releases the booking and its credit when PayMongo fails after credit was applied", async () => {
    mockGetBalance.mockResolvedValue({ balance: 30000 });
    mockCreateSession.mockRejectedValue(new Error("PayMongo unavailable"));

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(false);
    // Cancelling a pending booking fires the DB restore trigger, which is
    // what actually returns the credit — no explicit refund call here.
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });

  it("releases the booking when a fully covered booking cannot be confirmed", async () => {
    mockGetBalance.mockResolvedValue({ balance: 50000 });
    mockConfirmCreditOnly.mockResolvedValue(false);

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(false);
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });

  it("reads the balance server-side rather than trusting anything from the caller", async () => {
    mockGetBalance.mockResolvedValue({ balance: 30000 });

    await createCheckoutSessionAction({ ...VALUES, creditToApply: 50000 } as never);

    // The bogus client-supplied figure is ignored; the wallet's real
    // balance is what gets spent.
    expect(mockApplyCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 30000 }));
    expect(mockGetBalance).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("requires a signed-in user before any booking or wallet access", async () => {
    mockGetServerClient.mockResolvedValue({
      ok: true,
      client: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } },
    } as never);

    const result = await createCheckoutSessionAction(VALUES);

    expect(result).toEqual({ success: false, error: "Sign in to book a court." });
    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(mockGetBalance).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSessionAction — passed-on processing fee", () => {
  const ORIGINAL_GATE = process.env.PAYMONGO_PASS_ON_FEES_ENABLED;

  afterEach(() => {
    if (ORIGINAL_GATE === undefined) delete process.env.PAYMONGO_PASS_ON_FEES_ENABLED;
    else process.env.PAYMONGO_PASS_ON_FEES_ENABLED = ORIGINAL_GATE;
  });

  /** Whether this call asked PayMongo to add its fee to the charge. */
  function passedOnFees(): boolean | undefined {
    return mockCreateSession.mock.calls[0][0].passOnFees;
  }

  it("records no fee and does not pass fees on while the gate is off", async () => {
    delete process.env.PAYMONGO_PASS_ON_FEES_ENABLED;
    mockGetBalance.mockResolvedValue({ balance: 0 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    expect(mockSetProcessingFee).not.toHaveBeenCalled();
    expect(passedOnFees()).toBe(false);
    // Unchanged from the pre-fee behaviour: the bare court price.
    expect(chargedAmount()).toBe(50000);
  });

  it("records the grossed-up fee and passes fees on when the gate is on", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    mockGetBalance.mockResolvedValue({ balance: 0 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    // ₱500 grossed up at 1.5% -> ₱507.61 total, so a ₱7.61 fee.
    expect(mockSetProcessingFee).toHaveBeenCalledWith("booking-1", 761);
    expect(passedOnFees()).toBe(true);
    // The line item stays the court price — PayMongo adds the fee itself.
    expect(chargedAmount()).toBe(50000);
  });

  it("grosses up the POST-credit amount, never the full price", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    mockGetBalance.mockResolvedValue({ balance: 30000 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    // PayMongo only collects ₱200 here, so its fee is ₱200's (₱3.05), not
    // ₱500's (₱7.61). Grossing up the full price would overcharge every
    // customer paying partly in credit.
    expect(mockSetProcessingFee).toHaveBeenCalledWith("booking-1", 305);
  });

  it("charges no fee at all when credit covers the whole booking", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    mockGetBalance.mockResolvedValue({ balance: 50000 });

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(true);
    // No PayMongo session exists, so there is no fee to pass on — which is
    // exactly what the confirm dialog's "Book with AIR/Rally Credits and
    // this fee doesn't apply" promises.
    expect(mockSetProcessingFee).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("records the fee BEFORE the checkout session can be paid", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    mockGetBalance.mockResolvedValue({ balance: 0 });

    await createCheckoutSessionAction(VALUES);

    // Ordering is the safety property: the moment a session exists the
    // customer can pay it, and confirm_paymongo_booking_payment() reads
    // processing_fee_amount to build its expectation.
    expect(mockSetProcessingFee.mock.invocationCallOrder[0]).toBeLessThan(mockCreateSession.mock.invocationCallOrder[0]);
  });

  it("abandons checkout and releases the booking when the fee cannot be recorded", async () => {
    process.env.PAYMONGO_PASS_ON_FEES_ENABLED = "true";
    mockGetBalance.mockResolvedValue({ balance: 0 });
    mockSetProcessingFee.mockResolvedValue(false);

    const result = await createCheckoutSessionAction(VALUES);

    expect(result.success).toBe(false);
    // Never create a session whose grossed-up total the webhook would then
    // reject — that is the stuck-on-pending outage this feature exists to
    // end, not a state to ship into.
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockCancelBooking).toHaveBeenCalledWith(expect.anything(), "user-1", "booking-1");
  });
});
