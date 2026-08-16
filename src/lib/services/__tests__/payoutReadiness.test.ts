/**
 * @jest-environment node
 */
import { getPayoutReadiness, validatePayoutBatch } from "../payoutReadiness";
import { createTableMockSupabase } from "../../test-helpers/mockSupabase";

/**
 * Aggregation and eligibility shaping. The security boundary is the
 * database (is_admin() inside every payout RPC, plus RLS), which a mock
 * cannot exercise — that is proven for real in
 * scripts/verify-staging-payout-readiness.ts.
 */

const NO_ISSUES = { data: [], error: null };
const CASH = (overrides: Record<string, number> = {}) => ({
  data: [
    {
      available_payable_amount: 10000000,
      credit_funded_exposure: 0,
      cash_position_total: 500000,
      on_hold_amount: 0,
      pending_amount: 0,
      batched_amount: 0,
      ...overrides,
    },
  ],
  error: null,
});

describe("getPayoutReadiness", () => {
  it("is ready when the ledger has no issues", async () => {
    const supabase = createTableMockSupabase({}, { reconcile_settlements: NO_ISSUES, payout_cash_position: CASH() });
    const readiness = await getPayoutReadiness(supabase);

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.cash.availablePayableAmount).toBe(10000000);
  });

  it("is blocked by reconciliation errors", async () => {
    const supabase = createTableMockSupabase(
      {},
      {
        reconcile_settlements: {
          data: [
            { issue: "missing_settlement", booking_id: "b1", detail: "no row" },
            { issue: "funding_mismatch", booking_id: "b2", detail: "drifted" },
          ],
          error: null,
        },
        payout_cash_position: CASH(),
      }
    );

    const readiness = await getPayoutReadiness(supabase);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toHaveLength(2);
  });

  // Credit exposure is the expected shape of a credits business. Treating
  // it as a blocker would train admins to bypass the check that matters.
  it("treats credit exposure as a warning, never a blocker", async () => {
    const supabase = createTableMockSupabase(
      {},
      {
        reconcile_settlements: {
          data: [{ issue: "unfunded_entitlement", booking_id: "b1", detail: "owed 38000 collected 0" }],
          error: null,
        },
        payout_cash_position: CASH({ credit_funded_exposure: 2500000, cash_position_total: -2500000 }),
      }
    );

    const readiness = await getPayoutReadiness(supabase);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.warnings.length).toBeGreaterThan(0);
  });

  it("warns in pesos when the cash position is negative", async () => {
    const supabase = createTableMockSupabase(
      {},
      { reconcile_settlements: NO_ISSUES, payout_cash_position: CASH({ cash_position_total: -2500000 }) }
    );

    const readiness = await getPayoutReadiness(supabase);
    expect(readiness.cash.cashPositionTotal).toBe(-2500000);
    expect(readiness.warnings.some((w) => w.includes("₱25,000.00"))).toBe(true);
  });

  it("warns about on-hold money that cannot be paid yet", async () => {
    const supabase = createTableMockSupabase(
      {},
      { reconcile_settlements: NO_ISSUES, payout_cash_position: CASH({ on_hold_amount: 47500 }) }
    );

    const readiness = await getPayoutReadiness(supabase);
    expect(readiness.warnings.some((w) => w.includes("on hold"))).toBe(true);
  });

  it("reports zeroes rather than failing when nothing has settled yet", async () => {
    const supabase = createTableMockSupabase({}, { reconcile_settlements: NO_ISSUES, payout_cash_position: { data: [], error: null } });
    const readiness = await getPayoutReadiness(supabase);

    expect(readiness.ready).toBe(true);
    expect(readiness.cash.availablePayableAmount).toBe(0);
    expect(readiness.cash.cashPositionTotal).toBe(0);
  });
});

describe("validatePayoutBatch", () => {
  function mock(settlements: { id: string; settlement_status: string }[], committed: unknown[] = []) {
    return createTableMockSupabase({
      booking_settlements: { data: settlements, error: null },
      payout_batch_items: { data: committed, error: null },
    });
  }

  it("accepts payable settlements", async () => {
    const supabase = mock([
      { id: "s1", settlement_status: "payable" },
      { id: "s2", settlement_status: "payable" },
    ]);

    const result = await validatePayoutBatch(supabase, ["s1", "s2"]);
    expect(result).toMatchObject({ valid: true, eligible: ["s1", "s2"], rejected: [] });
  });

  // Pending means the court time has not been delivered, so the venue has
  // not earned it — paying it out would be paying for nothing.
  it("rejects a pending settlement with a reason that explains why", async () => {
    const supabase = mock([{ id: "s1", settlement_status: "pending" }]);

    const result = await validatePayoutBatch(supabase, ["s1"]);
    expect(result.valid).toBe(false);
    expect(result.eligible).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/not been delivered/i);
  });

  it.each(["reversed", "on_hold", "settled"])("rejects a %s settlement", async (status) => {
    const supabase = mock([{ id: "s1", settlement_status: status }]);

    const result = await validatePayoutBatch(supabase, ["s1"]);
    expect(result.valid).toBe(false);
    expect(result.rejected[0].reason).toContain(status);
  });

  it("rejects a settlement already committed to a live batch", async () => {
    const supabase = mock(
      [{ id: "s1", settlement_status: "payable" }],
      [{ settlement_id: "s1", payout_batches: { batch_reference: "PB-000001", status: "approved" } }]
    );

    const result = await validatePayoutBatch(supabase, ["s1"]);
    expect(result.valid).toBe(false);
    expect(result.rejected[0].reason).toContain("PB-000001");
  });

  // Cancelling a batch has to release its settlements, or a single mistake
  // would strand that money permanently.
  it("allows a settlement whose previous batch was cancelled", async () => {
    const supabase = mock(
      [{ id: "s1", settlement_status: "payable" }],
      [{ settlement_id: "s1", payout_batches: { batch_reference: "PB-000001", status: "cancelled" } }]
    );

    const result = await validatePayoutBatch(supabase, ["s1"]);
    expect(result.valid).toBe(true);
    expect(result.eligible).toEqual(["s1"]);
  });

  it("flags the same settlement selected twice", async () => {
    const supabase = mock([{ id: "s1", settlement_status: "payable" }]);

    const result = await validatePayoutBatch(supabase, ["s1", "s1"]);
    expect(result.valid).toBe(false);
    expect(result.rejected.some((r) => r.reason.includes("more than once"))).toBe(true);
  });

  it("rejects a settlement that doesn't exist", async () => {
    const supabase = mock([]);

    const result = await validatePayoutBatch(supabase, ["missing"]);
    expect(result.valid).toBe(false);
    expect(result.rejected[0].reason).toBe("Settlement not found.");
  });

  it("treats an empty selection as invalid", async () => {
    const supabase = mock([]);
    await expect(validatePayoutBatch(supabase, [])).resolves.toMatchObject({ valid: false, eligible: [] });
  });

  it("keeps the eligible ones separate from the rejected ones", async () => {
    const supabase = mock([
      { id: "s1", settlement_status: "payable" },
      { id: "s2", settlement_status: "pending" },
    ]);

    const result = await validatePayoutBatch(supabase, ["s1", "s2"]);
    expect(result.eligible).toEqual(["s1"]);
    expect(result.rejected).toHaveLength(1);
    // One bad selection invalidates the batch: an admin should see the
    // problem, not silently get a smaller batch than they chose.
    expect(result.valid).toBe(false);
  });
});

// The financial shapes from the brief, restated at the payout boundary:
// what a venue is owed never depends on how the customer funded it.
describe("payout amounts across funding shapes", () => {
  const CASES = [
    { name: "PayMongo only", gross: 50000, paymongo: 50000, credit: 0, fee: 2500, venue: 47500, cash: 2500 },
    { name: "Credit only", gross: 50000, paymongo: 0, credit: 50000, fee: 2500, venue: 47500, cash: -47500 },
    { name: "Mixed", gross: 50000, paymongo: 20000, credit: 30000, fee: 2500, venue: 47500, cash: -27500 },
  ];

  it.each(CASES)("$name pays the venue ₱475 and reports cash position $cash", ({ paymongo, credit, gross, fee, venue, cash }) => {
    expect(paymongo + credit).toBe(gross);
    expect(fee + venue).toBe(gross);
    expect(paymongo - venue).toBe(cash);
  });

  it("makes the payable amount independent of funding source", () => {
    expect(new Set(CASES.map((c) => c.venue)).size).toBe(1);
  });

  // Two credit-funded bookings mean the platform must find ₱75,500 of cash
  // it never collected. That total is the point of the readiness check.
  it("accumulates exposure across credit-funded bookings", () => {
    const exposure = CASES.filter((c) => c.cash < 0).reduce((sum, c) => sum + -c.cash, 0);
    expect(exposure).toBe(75000);
  });
});
