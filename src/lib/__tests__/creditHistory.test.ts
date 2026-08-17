import {
  withRunningBalance,
  creditEntryLabel,
  formatCreditAmount,
  formatCreditBalance,
} from "@/lib/creditHistory";
import type { CreditTransaction } from "@/lib/supabase/types";

function tx(overrides: Partial<CreditTransaction> & { id: string; amount: number }): CreditTransaction {
  return {
    user_id: "user-1",
    transaction_type: "cancellation_compensation",
    reference_id: null,
    description: null,
    created_at: "2026-08-19T10:00:00.000Z",
    ...overrides,
  } as CreditTransaction;
}

describe("withRunningBalance", () => {
  it("anchors the newest row to the wallet balance and walks backwards", () => {
    // Newest first, as listCreditTransactions returns them.
    const entries = withRunningBalance(
      [
        tx({ id: "c", amount: -20000, transaction_type: "booking_payment" }),
        tx({ id: "b", amount: 40000 }),
        tx({ id: "a", amount: 30000, transaction_type: "promotion_bonus" }),
      ],
      50000
    );

    expect(entries.map((e) => [e.id, e.runningBalance])).toEqual([
      ["c", 50000], // after spending 200 -> 500
      ["b", 70000], // before that spend it was 700
      ["a", 30000], // and before the 400 credit, 300
    ]);
  });

  it("reconciles to the wallet balance rather than to a sum of the page", () => {
    // A truncated history — the oldest rows are not on this page at all.
    // Summing forwards from zero would print a running balance that never
    // reaches the balance shown above it.
    const entries = withRunningBalance([tx({ id: "only", amount: 10000 })], 99000);
    expect(entries[0].runningBalance).toBe(99000);
  });

  it("returns nothing for an empty ledger", () => {
    expect(withRunningBalance([], 0)).toEqual([]);
  });
});

describe("creditEntryLabel", () => {
  it("prefers the ledger's own description", () => {
    expect(creditEntryLabel(tx({ id: "1", amount: 100, description: "Cancelled — Court 2" }))).toBe(
      "Cancelled — Court 2"
    );
  });

  it("never shows a raw enum when the description is missing or blank", () => {
    expect(creditEntryLabel(tx({ id: "1", amount: 100, description: null }))).toBe("Booking cancelled");
    expect(creditEntryLabel(tx({ id: "2", amount: 100, description: "   " }))).toBe("Booking cancelled");
    expect(creditEntryLabel(tx({ id: "3", amount: -100, transaction_type: "booking_payment" }))).toBe(
      "Paid for a booking"
    );
  });
});

describe("formatting", () => {
  it("makes the direction explicit on every amount", () => {
    expect(formatCreditAmount(40000)).toBe("+₱400.00");
    expect(formatCreditAmount(-40000)).toBe("−₱400.00");
  });

  it("formats a balance without a sign", () => {
    expect(formatCreditBalance(40609)).toBe("₱406.09");
    expect(formatCreditBalance(0)).toBe("₱0.00");
  });
});
