/**
 * @jest-environment node
 */
import { resolveCancellationCredit, splitBookingPayment, getUserCreditBalance, listCreditTransactions } from "../credits";
import { createMockSupabase } from "../../test-helpers/mockSupabase";

const START = "2026-08-20T10:00:00Z";
/** 72h before START — comfortably outside the 48h cutoff. */
const WELL_AHEAD = new Date("2026-08-17T10:00:00Z").getTime();
/** 2h before START — inside the cutoff. */
const LAST_MINUTE = new Date("2026-08-20T08:00:00Z").getTime();
/** Exactly 48h before START — the boundary itself. */
const EXACTLY_AT_CUTOFF = new Date("2026-08-18T10:00:00Z").getTime();

describe("resolveCancellationCredit", () => {
  it("credits a customer in full when they cancel well before the cutoff", () => {
    const d = resolveCancellationCredit({ cause: "customer", amountPaid: 80000, startTime: START, now: WELL_AHEAD });
    expect(d).toMatchObject({ amount: 80000, eligible: true });
  });

  it("credits nothing when a customer cancels inside the cutoff", () => {
    const d = resolveCancellationCredit({ cause: "customer", amountPaid: 80000, startTime: START, now: LAST_MINUTE });
    expect(d).toMatchObject({ amount: 0, eligible: false });
  });

  // The boundary is inclusive: cancelling at exactly 48 hours still
  // qualifies, so a customer isn't penalised for landing on the line.
  it("treats exactly 48 hours as still eligible", () => {
    const d = resolveCancellationCredit({ cause: "customer", amountPaid: 80000, startTime: START, now: EXACTLY_AT_CUTOFF });
    expect(d.eligible).toBe(true);
  });

  // The cutoff exists to stop customers cancelling a court nobody else
  // can now book. None of these causes are the customer's doing, so it
  // must not apply to them — even minutes before the start.
  it.each(["venue", "venue_unavailable", "system_error", "support_review"] as const)(
    "compensates '%s' in full regardless of how close to the start time it is",
    (cause) => {
      const d = resolveCancellationCredit({ cause, amountPaid: 80000, startTime: START, now: LAST_MINUTE });
      expect(d).toMatchObject({ amount: 80000, eligible: true });
    }
  );

  it("credits nothing when nothing was paid, whatever the cause", () => {
    const d = resolveCancellationCredit({ cause: "venue", amountPaid: 0, startTime: START, now: WELL_AHEAD });
    expect(d).toMatchObject({ amount: 0, eligible: false });
  });

  it("gives a customer-safe reason on every branch", () => {
    const causes = ["customer", "venue", "venue_unavailable", "system_error", "support_review"] as const;
    for (const cause of causes) {
      const d = resolveCancellationCredit({ cause, amountPaid: 80000, startTime: START, now: LAST_MINUTE });
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("splitBookingPayment", () => {
  // The three scenarios from the brief.
  it("splits ₱800 with ₱300 credit into ₱300 credit + ₱500 due", () => {
    expect(splitBookingPayment({ priceAmount: 80000, availableCredit: 30000 })).toEqual({
      creditApplied: 30000,
      amountDue: 50000,
      fullyCoveredByCredit: false,
    });
  });

  it("covers ₱500 entirely from ₱500 credit, leaving nothing for PayMongo", () => {
    expect(splitBookingPayment({ priceAmount: 50000, availableCredit: 50000 })).toEqual({
      creditApplied: 50000,
      amountDue: 0,
      fullyCoveredByCredit: true,
    });
  });

  // Never spends more credit than the booking costs. The ₱500 booking is
  // fully covered and the surplus ₱200 simply stays in the wallet — it is
  // not "due", and it is not spent.
  it("spends only what the booking costs when credit exceeds it", () => {
    expect(splitBookingPayment({ priceAmount: 50000, availableCredit: 70000 })).toEqual({
      creditApplied: 50000,
      amountDue: 0,
      fullyCoveredByCredit: true,
    });
  });

  it("applies nothing and charges the full price when the wallet is empty", () => {
    expect(splitBookingPayment({ priceAmount: 50000, availableCredit: 0 })).toEqual({
      creditApplied: 0,
      amountDue: 50000,
      fullyCoveredByCredit: false,
    });
  });

  it("never produces a negative credit application from a negative balance", () => {
    expect(splitBookingPayment({ priceAmount: 50000, availableCredit: -100 }).creditApplied).toBe(0);
  });
});

describe("getUserCreditBalance", () => {
  it("reports zero for a user who has never had a wallet row", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getUserCreditBalance(supabase, "user-1")).resolves.toEqual({ balance: 0 });
  });

  it("returns the stored balance", async () => {
    const supabase = createMockSupabase({ data: { balance: 50000 }, error: null });
    await expect(getUserCreditBalance(supabase, "user-1")).resolves.toEqual({ balance: 50000 });
  });
});

describe("listCreditTransactions", () => {
  it("scopes to the user and orders newest first", async () => {
    const rows = [{ id: "t1", user_id: "user-1", amount: 50000 }];
    const supabase = createMockSupabase({ data: rows, error: null });
    await expect(listCreditTransactions(supabase, "user-1")).resolves.toEqual(rows);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock; order: jest.Mock };
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});
