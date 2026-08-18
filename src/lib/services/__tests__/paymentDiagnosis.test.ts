/**
 * @jest-environment node
 */
import { diagnoseUnconfirmedPayment, reportUnconfirmedPayment } from "../bookings";

jest.mock("../../errors", () => ({ logServerError: jest.fn() }));
// bookings.ts pulls these in at module load; neither is exercised here.
jest.mock("../paymongo", () => ({ retrievePayMongoCheckoutSession: jest.fn() }));
jest.mock("../../supabase/serviceRole", () => ({ createServiceRoleClient: jest.fn() }));

import { logServerError } from "../../errors";
const mockLog = logServerError as jest.MockedFunction<typeof logServerError>;

/** A ₱400 booking charged ₱406.09 — the shape every live booking has. */
const BOOKING = {
  id: "booking-1",
  confirmation_code: "D8732925",
  status: "pending",
  price_amount: 40000,
  credit_amount_applied: 0,
  processing_fee_amount: 609,
  currency: "PHP",
  paymongo_checkout_session_id: "cs_1",
};

/**
 * Minimal supabase double: one bookings row and an optional pending
 * reschedule. Only the two reads diagnoseUnconfirmedPayment() performs.
 */
function client(booking: Record<string, unknown> | null, reschedule: Record<string, unknown> | null = null) {
  return {
    from(table: string) {
      if (table === "bookings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: booking, error: null }) }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reschedule, error: null }) }) }) }),
      };
    },
  } as never;
}

const PAID = { bookingId: "booking-1", paidAmount: 40609, paidCurrency: "PHP", checkoutSessionId: "cs_1" };

beforeEach(() => mockLog.mockReset());

describe("diagnoseUnconfirmedPayment", () => {
  it("recognises an already-confirmed booking as ordinary, not a fault", async () => {
    const d = await diagnoseUnconfirmedPayment(client({ ...BOOKING, status: "confirmed" }), PAID);
    expect(d.kind).toBe("already_confirmed");
  });

  it("recognises a reschedule difference as ordinary — it confirms elsewhere by design", async () => {
    const d = await diagnoseUnconfirmedPayment(client(BOOKING, { id: "r1", price_difference: 5000 }), PAID);
    expect(d.kind).toBe("reschedule_difference");
  });

  it("identifies the live-rate drift that would strand a real payment", async () => {
    // PayMongo bills the published 1.5008% instead of the measured 1.5%:
    // ₱400 court charged 40610 against a stored expectation of 40609.
    const d = await diagnoseUnconfirmedPayment(client(BOOKING), { ...PAID, paidAmount: 40610 });

    expect(d.kind).toBe("amount_mismatch");
    if (d.kind !== "amount_mismatch") throw new Error("unreachable");
    expect(d.expected).toBe(40609);
    expect(d.actual).toBe(40610);
    expect(d.delta).toBe(1);
    // The detail must carry both figures — recalibration starts from them.
    expect(d.detail).toContain("40610");
    expect(d.detail).toContain("40609");
    expect(d.detail).toMatch(/HAS PAID/);
  });

  it("accounts for applied credit when computing what was expected", async () => {
    // price 40000 - credit 10000 + fee 609 = 30609
    const withCredit = { ...BOOKING, credit_amount_applied: 10000 };
    const d = await diagnoseUnconfirmedPayment(client(withCredit), { ...PAID, paidAmount: 99999 });
    if (d.kind !== "amount_mismatch") throw new Error(`expected amount_mismatch, got ${d.kind}`);
    expect(d.expected).toBe(30609);
  });

  it("distinguishes a stale session from an amount problem", async () => {
    const d = await diagnoseUnconfirmedPayment(client(BOOKING), { ...PAID, checkoutSessionId: "cs_other" });
    expect(d.kind).toBe("session_mismatch");
  });

  it("distinguishes a currency problem from an amount problem", async () => {
    const d = await diagnoseUnconfirmedPayment(client({ ...BOOKING, currency: "USD" }), PAID);
    expect(d.kind).toBe("currency_mismatch");
  });

  it("reports a missing booking rather than guessing", async () => {
    const d = await diagnoseUnconfirmedPayment(client(null), PAID);
    expect(d.kind).toBe("booking_not_found");
  });
});

describe("reportUnconfirmedPayment", () => {
  it("stays silent for the two ordinary causes", () => {
    // THE POINT: the old code logged one line for every cause, so a real
    // mismatch was indistinguishable from a duplicate webhook delivery.
    expect(reportUnconfirmedPayment("t", { kind: "already_confirmed", detail: "x" })).toBe(false);
    expect(reportUnconfirmedPayment("t", { kind: "reschedule_difference", detail: "x" })).toBe(false);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("raises an alarm naming the source for a genuine mismatch", () => {
    const raised = reportUnconfirmedPayment("paymongo.webhook", {
      kind: "amount_mismatch",
      expected: 40609,
      actual: 40610,
      delta: 1,
      detail: "detail here",
    });

    expect(raised).toBe(true);
    expect(mockLog).toHaveBeenCalledWith("paymongo.webhook.PAID_BUT_UNCONFIRMED.amountMismatch", expect.any(Error), {
      critical: true,
    });
  });

  it("raises for unexpected causes too, rather than swallowing them", () => {
    expect(reportUnconfirmedPayment("t", { kind: "session_mismatch", detail: "x" })).toBe(true);
    expect(reportUnconfirmedPayment("t", { kind: "unknown", detail: "x" })).toBe(true);
    expect(mockLog).toHaveBeenCalledTimes(2);
  });
});
