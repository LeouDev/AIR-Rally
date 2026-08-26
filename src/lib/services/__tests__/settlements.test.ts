/**
 * @jest-environment node
 */
import {
  getOwnerSettlementSummary,
  listOwnerSettlements,
  countOwnerSettlements,
  getOwnerSettlementsForExport,
  OWNER_SETTLEMENTS_SAFETY_CAP,
  getAdminSettlementSummary,
  listAllSettlements,
  getSettlementIssues,
} from "../settlements";
import { createMockSupabase, createRpcMockSupabase, createTableMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";

/**
 * These cover the aggregation and shaping. The security boundary itself is
 * RLS, which cannot be exercised by a mock — it is verified for real
 * against staging in scripts/verify-staging-settlement-ui.ts.
 */

type Row = {
  venue_amount: number;
  paymongo_amount?: number;
  cash_position?: number;
  settlement_status: string;
  currency: string;
};

/** A ₱500 booking under the 5% fee, all cash: ₱25 platform, ₱475 venue, ₱500 collected. */
function row(overrides: Partial<Row> = {}): Row {
  return {
    venue_amount: 47500,
    paymongo_amount: 50000,
    cash_position: 2500,
    settlement_status: "pending",
    currency: "PHP",
    ...overrides,
  };
}

describe("getOwnerSettlementSummary", () => {
  it("reports zeroes when the owner has no settlements", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(getOwnerSettlementSummary(supabase)).resolves.toMatchObject({
      pending: 0,
      available: 0,
      paid: 0,
      currency: "PHP",
    });
  });

  it("splits entitlement across pending and available", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "pending" }),
        row({ settlement_status: "pending" }),
        row({ settlement_status: "payable" }),
      ],
      error: null,
    });

    await expect(getOwnerSettlementSummary(supabase)).resolves.toMatchObject({
      pending: 95000,
      pendingCount: 2,
      available: 47500,
      availableCount: 1,
    });
  });

  // Earned-but-unpaid must never be shown as paid: an owner reading "Paid"
  // against money still sitting with us is the worst possible misreading of
  // this card. The assertion was always right; its old name said "because no
  // payout writer exists", which stopped being true on 2026-08-26.
  it("does not count pending or payable as paid", async () => {
    const supabase = createMockSupabase({
      data: [row({ settlement_status: "pending" }), row({ settlement_status: "payable" })],
      error: null,
    });
    await expect(getOwnerSettlementSummary(supabase)).resolves.toMatchObject({ paid: 0, paidCount: 0 });
  });

  /**
   * The case that could not happen until migration 20260810000093, and was
   * therefore never asserted: attest_payout_settled() now moves a batch's
   * settlements payable -> settled in the same transaction as the transfer
   * attestation, so `paid` is real money that actually left.
   *
   * Without this, the suite would still pass with `paid` hardcoded to 0 --
   * which is precisely what the old comment claimed it was.
   */
  it("counts settled as paid, now that attestation writes it", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "settled" }),
        row({ settlement_status: "settled" }),
        row({ settlement_status: "payable" }),
      ],
      error: null,
    });
    const summary = await getOwnerSettlementSummary(supabase);
    expect(summary.paidCount).toBe(2);
    expect(summary.paid).toBeGreaterThan(0);
  });

  // Neither is money the owner should expect, so neither may inflate a card.
  it("excludes reversed and on-hold settlements from every total", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "reversed" }),
        row({ settlement_status: "on_hold" }),
        row({ settlement_status: "payable" }),
      ],
      error: null,
    });

    await expect(getOwnerSettlementSummary(supabase)).resolves.toMatchObject({
      pending: 0,
      available: 47500,
      paid: 0,
    });
  });

  it("propagates a query error rather than reporting zero earnings", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "boom") });
    // PostgREST errors are plain objects, not Error instances — the
    // service rethrows them as-is, same as every other service here.
    await expect(getOwnerSettlementSummary(supabase)).rejects.toMatchObject({ message: "boom", code: "42501" });
  });
});

describe("listOwnerSettlements", () => {
  it("does NOT filter by owner — RLS is the boundary", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listOwnerSettlements(supabase);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq?: jest.Mock; order: jest.Mock };
    // An .eq("owner_id", ...) here would imply the filtering happened in
    // application code, which is exactly the impression to avoid.
    expect(builder.eq).not.toHaveBeenCalled();
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("maps a row to the display shape, surviving missing embeds", async () => {
    const supabase = createMockSupabase({
      data: [
        {
          id: "s1",
          booking_id: "b1",
          venue_id: "v1",
          currency: "PHP",
          gross_booking_amount: 50000,
          paymongo_amount: 50000,
          credit_amount: 0,
          platform_fee: 2500,
          venue_amount: 47500,
          cash_position: 2500,
          settlement_source: "paymongo",
          settlement_status: "pending",
          created_at: "2026-08-16T00:00:00Z",
          venues: null,
          bookings: null,
        },
      ],
      error: null,
    });

    const [mapped] = await listOwnerSettlements(supabase);
    expect(mapped).toMatchObject({
      settlementId: "s1",
      venueName: "Unknown venue",
      courtName: null,
      venueAmount: 47500,
      settlementSource: "paymongo",
    });
  });
});

describe("countOwnerSettlements", () => {
  it("returns the exact count independent of any row limit", async () => {
    const supabase = createMockSupabase({ data: null, error: null, count: 42 });
    await expect(countOwnerSettlements(supabase)).resolves.toBe(42);
  });

  it("returns 0 rather than null when the owner has no settlements", async () => {
    const supabase = createMockSupabase({ data: null, error: null, count: null });
    await expect(countOwnerSettlements(supabase)).resolves.toBe(0);
  });

  it("propagates a query error rather than reporting zero", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "boom"), count: null });
    await expect(countOwnerSettlements(supabase)).rejects.toMatchObject({ message: "boom", code: "42501" });
  });
});

describe("getOwnerSettlementsForExport", () => {
  function rawRow(id: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      id,
      booking_id: `b-${id}`,
      venue_id: "v1",
      currency: "PHP",
      gross_booking_amount: 50000,
      paymongo_amount: 50000,
      credit_amount: 0,
      platform_fee: 2500,
      venue_amount: 47500,
      cash_position: 2500,
      settlement_source: "paymongo",
      settlement_status: "pending",
      created_at: "2026-08-16T00:00:00Z",
      venues: null,
      bookings: null,
      ...overrides,
    };
  }

  /**
   * Genuinely enforces `.limit(n)` (unlike createMockSupabase, which
   * ignores it and hands back the fixture verbatim) — the whole point of
   * this test is to fail if the export ever regresses to a display-sized
   * cap, which a mock that can't truncate could never catch.
   */
  function createLimitAwareSettlementsMock(allRows: Record<string, unknown>[]) {
    let appliedLimit = allRows.length;
    const builder: Record<string, unknown> = {
      select: jest.fn(() => builder),
      order: jest.fn(() => builder),
      in: jest.fn(() => builder),
      limit: jest.fn((n: number) => {
        appliedLimit = n;
        return builder;
      }),
      then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
        Promise.resolve({ data: allRows.slice(0, appliedLimit), count: allRows.length, error: null }).then(
          onfulfilled,
          onrejected
        ),
    };
    return { from: jest.fn(() => builder) } as unknown as Parameters<typeof getOwnerSettlementsForExport>[0];
  }

  // This is the exact regression the CTO flagged: an export silently
  // capped well below a realistic history, with nothing on screen to
  // contradict it. Fails against the old default (100) — passes only
  // once the export reads through the raised safety ceiling instead.
  it("returns every row up to the safety cap, not the on-page table's small display limit", async () => {
    const allRows = Array.from({ length: 150 }, (_, i) => rawRow(`s${i}`));
    const supabase = createLimitAwareSettlementsMock(allRows);

    const result = await getOwnerSettlementsForExport(supabase, "owner-1");

    expect(result.rows).toHaveLength(150);
    expect(result.totalMatching).toBe(150);
    expect(result.truncated).toBe(false);
  });

  it("flags truncation honestly rather than silently stopping, if a real result ever exceeds the safety cap", async () => {
    const allRows = Array.from({ length: OWNER_SETTLEMENTS_SAFETY_CAP + 5 }, (_, i) => rawRow(`s${i}`));
    const supabase = createLimitAwareSettlementsMock(allRows);

    const result = await getOwnerSettlementsForExport(supabase, "owner-1");

    expect(result.rows).toHaveLength(OWNER_SETTLEMENTS_SAFETY_CAP);
    expect(result.totalMatching).toBe(OWNER_SETTLEMENTS_SAFETY_CAP + 5);
    expect(result.truncated).toBe(true);
  });

  /**
   * Real filtering on `bookings.start_time` (like ownerAnalytics.test.ts's
   * own fetch-window-aware mock) — a mock that ignored `.gte()`/`.lte()`
   * could never catch the bug this exists to prevent: an export that
   * ignores the owner's on-screen date filter and returns recent rows
   * regardless of what range was requested.
   */
  function createDateRangeAwareMock(tables: {
    venues: unknown[];
    courts: unknown[];
    bookings: Record<string, unknown>[];
    settlements: Record<string, unknown>[];
  }) {
    const bookingFilters: Array<(row: Record<string, unknown>) => boolean> = [];
    const bookingsBuilder: Record<string, unknown> = {
      select: jest.fn(() => bookingsBuilder),
      in: jest.fn(() => bookingsBuilder),
      gte: jest.fn((column: string, value: string) => {
        if (column === "start_time") bookingFilters.push((row) => (row.start_time as string) >= value);
        return bookingsBuilder;
      }),
      lte: jest.fn((column: string, value: string) => {
        if (column === "start_time") bookingFilters.push((row) => (row.start_time as string) <= value);
        return bookingsBuilder;
      }),
      then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
        Promise.resolve({ data: tables.bookings.filter((row) => bookingFilters.every((f) => f(row))), error: null }).then(
          onfulfilled,
          onrejected
        ),
    };

    let settlementBookingIds: string[] | null = null;
    const settlementsBuilder: Record<string, unknown> = {
      select: jest.fn(() => settlementsBuilder),
      order: jest.fn(() => settlementsBuilder),
      limit: jest.fn(() => settlementsBuilder),
      in: jest.fn((column: string, ids: string[]) => {
        if (column === "booking_id") settlementBookingIds = ids;
        return settlementsBuilder;
      }),
      then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) => {
        const rows = settlementBookingIds
          ? tables.settlements.filter((row) => settlementBookingIds!.includes(row.booking_id as string))
          : tables.settlements;
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(onfulfilled, onrejected);
      },
    };

    const other = createTableMockSupabase({
      venues: { data: tables.venues, error: null },
      courts: { data: tables.courts, error: null },
    });

    return {
      ...other,
      from: jest.fn((table: string) => {
        if (table === "bookings") return bookingsBuilder;
        if (table === "booking_settlements") return settlementsBuilder;
        return (other.from as (t: string) => unknown)(table);
      }),
    } as unknown as Parameters<typeof getOwnerSettlementsForExport>[0];
  }

  const VENUE = { id: "v1", name: "Court Central", owner_id: "owner-1", timezone: "Asia/Manila" };
  const COURT = { id: "c1", name: "Court A", venue_id: "v1" };

  it("exports only the settlements whose booking falls in the requested range", async () => {
    const supabase = createDateRangeAwareMock({
      venues: [VENUE],
      courts: [COURT],
      bookings: [
        { id: "in-range", court_id: "c1", start_time: "2026-08-15T04:00:00Z" }, // Aug 15 in Asia/Manila
        { id: "out-of-range", court_id: "c1", start_time: "2026-09-01T04:00:00Z" },
      ],
      settlements: [rawRow("s-in", { booking_id: "in-range" }), rawRow("s-out", { booking_id: "out-of-range" })],
    });

    const result = await getOwnerSettlementsForExport(supabase, "owner-1", {
      dateRange: { from: "2026-08-01", to: "2026-08-31" },
    });

    expect(result.rows.map((r) => r.settlementId)).toEqual(["s-in"]);
    expect(result.totalMatching).toBe(1);
  });

  it("returns nothing, not everything, when the owner has no bookings in the requested range", async () => {
    const supabase = createDateRangeAwareMock({
      venues: [VENUE],
      courts: [COURT],
      bookings: [{ id: "b1", court_id: "c1", start_time: "2026-09-01T04:00:00Z" }],
      settlements: [rawRow("s1", { booking_id: "b1" })],
    });

    const result = await getOwnerSettlementsForExport(supabase, "owner-1", {
      dateRange: { from: "2026-08-01", to: "2026-08-31" },
    });

    expect(result.rows).toEqual([]);
    expect(result.totalMatching).toBe(0);
  });
});

describe("getAdminSettlementSummary", () => {
  it("totals liability as pending plus payable", async () => {
    const supabase = createMockSupabase({
      data: [row({ settlement_status: "pending" }), row({ settlement_status: "payable" })],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({
      totalVenueLiability: 95000,
      pendingAmount: 47500,
      payableAmount: 47500,
    });
  });

  // The number the whole ledger exists to surface.
  it("reports credit-funded exposure as a positive obligation", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "pending", cash_position: -47500 }),
        row({ settlement_status: "payable", cash_position: -27500 }),
        row({ settlement_status: "pending", cash_position: 2500 }),
      ],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({ creditFundedExposure: 75000 });
  });

  // A reversed settlement is no longer owed, so its shortfall is not an
  // obligation and must not inflate the exposure figure.
  it("excludes reversed settlements from exposure", async () => {
    const supabase = createMockSupabase({
      data: [row({ settlement_status: "reversed", cash_position: -47500 })],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({
      creditFundedExposure: 0,
      reversedCount: 1,
      totalVenueLiability: 0,
    });
  });

  // The venue's entitlement is withdrawn on reversal, but the original
  // charge never was — AIR/Rally keeps the full paymongo_amount, not just
  // its platform fee.
  it("sums real cash retained from reversed settlements", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "reversed", paymongo_amount: 50000 }),
        row({ settlement_status: "reversed", paymongo_amount: 40000 }),
        row({ settlement_status: "pending", paymongo_amount: 50000 }), // still live — excluded
        row({ settlement_status: "on_hold", paymongo_amount: 50000 }), // already paid out — excluded
      ],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({ retainedFromReversedAmount: 90000 });
  });

  // Credit-funded bookings never collected real cash, so a reversed one
  // must contribute 0, not something derived from venue_amount or gross.
  it("credit-funded reversed settlements contribute nothing to retained cash", async () => {
    const supabase = createMockSupabase({
      data: [row({ settlement_status: "reversed", paymongo_amount: 0 })],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({ retainedFromReversedAmount: 0 });
  });

  it("counts on-hold settlements so they can be surfaced for review", async () => {
    const supabase = createMockSupabase({ data: [row({ settlement_status: "on_hold" })], error: null });
    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({ onHoldCount: 1 });
  });

  // The new "how much did we actually collect" figure — real PayMongo cash,
  // never derived from venue_amount or cash_position.
  it("totals real cash collected across live settlements only", async () => {
    const supabase = createMockSupabase({
      data: [
        row({ settlement_status: "pending", paymongo_amount: 50000 }), // all cash
        row({ settlement_status: "payable", paymongo_amount: 10000, cash_position: -37500 }), // mixed
        row({ settlement_status: "reversed", paymongo_amount: 50000 }), // no longer live — excluded
      ],
      error: null,
    });

    await expect(getAdminSettlementSummary(supabase)).resolves.toMatchObject({ totalCollectedAmount: 60000 });
  });
});

describe("listAllSettlements", () => {
  it("applies a status filter when given one", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listAllSettlements(supabase, { status: "payable" });

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).toHaveBeenCalledWith("settlement_status", "payable");
  });

  it("applies no status filter when none is given", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listAllSettlements(supabase);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).not.toHaveBeenCalled();
  });
});

describe("getSettlementIssues", () => {
  it("separates real problems from expected credit exposure", async () => {
    const supabase = createRpcMockSupabase({
      data: [
        { issue: "missing_settlement", booking_id: "b1", detail: "no row" },
        { issue: "unfunded_entitlement", booking_id: "b2", detail: "owed 38000 collected 0" },
        { issue: "funding_mismatch", booking_id: "b3", detail: "drifted" },
      ],
      error: null,
    });

    const groups = await getSettlementIssues(supabase);
    expect(groups.errors.map((e) => e.issue)).toEqual(["missing_settlement", "funding_mismatch"]);
    expect(groups.exposure).toHaveLength(1);
  });

  it("reports a clean ledger as no errors and no exposure", async () => {
    const supabase = createRpcMockSupabase({ data: [], error: null });
    await expect(getSettlementIssues(supabase)).resolves.toEqual({ errors: [], exposure: [] });
  });

  // A credit-only ledger is healthy, not broken — the page must be able to
  // say "no issues" while still showing exposure.
  it("treats a ledger of only credit exposure as error-free", async () => {
    const supabase = createRpcMockSupabase({
      data: [{ issue: "unfunded_entitlement", booking_id: "b1", detail: "owed 38000 collected 0" }],
      error: null,
    });

    const groups = await getSettlementIssues(supabase);
    expect(groups.errors).toHaveLength(0);
    expect(groups.exposure).toHaveLength(1);
  });
});

// The three funding shapes from the brief, asserted as the ledger's own
// arithmetic rather than as anything this layer recomputes.
describe("the three funding shapes", () => {
  const CASES = [
    { name: "PayMongo only", gross: 50000, paymongo: 50000, credit: 0, fee: 2500, venue: 47500, cash: 2500 },
    { name: "Credit only", gross: 50000, paymongo: 0, credit: 50000, fee: 2500, venue: 47500, cash: -47500 },
    { name: "Mixed", gross: 50000, paymongo: 20000, credit: 30000, fee: 2500, venue: 47500, cash: -27500 },
  ];

  it.each(CASES)("$name balances on both identities", ({ gross, paymongo, credit, fee, venue }) => {
    expect(paymongo + credit).toBe(gross);
    expect(fee + venue).toBe(gross);
  });

  it.each(CASES)("$name reports the expected cash position", ({ paymongo, venue, cash }) => {
    expect(paymongo - venue).toBe(cash);
  });

  it("owes the venue the same amount regardless of how it was funded", () => {
    expect(new Set(CASES.map((c) => c.venue)).size).toBe(1);
  });
});
