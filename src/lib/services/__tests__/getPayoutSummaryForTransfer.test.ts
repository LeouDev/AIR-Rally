/**
 * @jest-environment node
 */
import { getPayoutSummaryForTransfer } from "../payouts";

/**
 * getPayoutSummaryForTransfer() is the one data source behind BOTH the
 * admin preview and the real payslip email — see payoutPayslipEmail.ts's
 * own comment for why that's a rule. This is where its two real jobs get
 * tested independently: computing the four money lines + honest period
 * from real rows, and the defense-in-depth entitlement check that stops
 * this specific payload (a venue's revenue, bank reference, and masked
 * account number) reaching the wrong recipient — see the entitlement
 * discussion in [[payslip-never-actually-sent]].
 */

const TRANSFER = { id: "transfer-1", payout_batch_id: "batch-1", venue_id: "venue-1", amount: 76000, provider_fee: 1000 };
const BATCH = { batch_reference: "PB-000002" };
const VENUE = { name: "Banilad Pickle Club", timezone: "Asia/Manila", owner_id: "owner-1" };
const ACCOUNT = { bank_name: "BPI", bank_account_number: "001234567890" };
const ITEMS = [{ settlement_id: "s1" }, { settlement_id: "s2" }];
const SETTLEMENTS = [
  { gross_booking_amount: 40000, platform_fee: 2000, booking_id: "b1" },
  { gross_booking_amount: 40000, platform_fee: 2000, booking_id: "b2" },
];
const BOOKINGS = [
  { id: "b1", start_time: "2026-08-23T02:00:00Z" },
  { id: "b2", start_time: "2026-08-26T02:00:00Z" },
];

function mockSupabase(
  overrides: {
    venue?: typeof VENUE | null;
    account?: typeof ACCOUNT | null;
    items?: typeof ITEMS;
    bookings?: typeof BOOKINGS;
  } = {}
) {
  const venue = overrides.venue === undefined ? VENUE : overrides.venue;
  const account = overrides.account === undefined ? ACCOUNT : overrides.account;
  const items = overrides.items ?? ITEMS;
  const bookings = overrides.bookings ?? BOOKINGS;

  return {
    from: jest.fn((table: string) => {
      if (table === "payout_transfers") {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: TRANSFER, error: null }) })) })) };
      }
      if (table === "payout_batches") {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: BATCH, error: null }) })) })) };
      }
      if (table === "venues") {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: venue, error: null }) })) })) };
      }
      if (table === "venue_payment_accounts") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: account, error: null }) })) })),
          })),
        };
      }
      if (table === "payout_batch_items") {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: items, error: null }) })) })) };
      }
      if (table === "booking_settlements") {
        return { select: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: SETTLEMENTS, error: null }) })) };
      }
      if (table === "bookings") {
        return { select: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: bookings, error: null }) })) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as Parameters<typeof getPayoutSummaryForTransfer>[0];
}

describe("getPayoutSummaryForTransfer — the money and the period", () => {
  it("computes all four money lines from the settlement rows, reconciling by construction", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1");
    expect(summary?.courtEarningsTotal).toBe(80000);
    expect(summary?.commissionTotal).toBe(4000);
    expect(summary?.transferFee).toBe(1000);
    expect(summary?.amountTransferred).toBe(75000);
    expect(summary?.courtEarningsTotal! - summary?.commissionTotal! - summary?.transferFee!).toBe(summary?.amountTransferred);
  });

  it("masks the account to the last 4 digits only", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1");
    expect(summary?.bankAccountLast4).toBe("7890");
  });

  it("states the true period — a single week here, since both bookings fall in one", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1");
    expect(summary?.periodLabel).toBe("August 23, 2026 – August 29, 2026");
  });

  // THE DISCRIMINATOR: two bookings two weeks apart must produce a real
  // multi-week label, not a range silently narrowed to one week — see
  // payoutPayslipEmail.ts's comment on why a forced Sunday–Saturday shape
  // would eventually contradict the batch's own contents.
  it("states an honest multi-week range when the batch spans more than one week", async () => {
    const singleWeek = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1");
    const multiWeek = await getPayoutSummaryForTransfer(
      mockSupabase({
        bookings: [
          { id: "b1", start_time: "2026-08-09T02:00:00Z" },
          { id: "b2", start_time: "2026-08-23T02:00:00Z" },
        ],
      }),
      "transfer-1"
    );
    expect(multiWeek?.periodLabel).not.toBe(singleWeek?.periodLabel);
    expect(multiWeek?.periodLabel).toMatch(/August 9, 2026.*August 29, 2026/);
  });

  it("returns null rather than throwing when the venue has no complete bank details on file", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase({ account: null }), "transfer-1");
    expect(summary).toBeNull();
  });

  it("returns null when the venue can't be found", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase({ venue: null }), "transfer-1");
    expect(summary).toBeNull();
  });

  it("returns null rather than throwing when there are zero settlements to summarize", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase({ items: [] }), "transfer-1");
    expect(summary).toBeNull();
  });
});

describe("getPayoutSummaryForTransfer — entitlement (defense in depth)", () => {
  it("builds the summary when the expected owner matches the venue's real owner", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1", "owner-1");
    expect(summary).not.toBeNull();
  });

  /**
   * THE DISCRIMINATOR THAT MATTERS HERE: a caller claiming to be someone
   * other than venue.owner_id must get null, never the real figures. This
   * is the check the CTO asked to confirm exists before this shipped.
   */
  it("returns null, not the summary, when the expected owner does NOT match the venue's real owner", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1", "someone-else");
    expect(summary).toBeNull();
  });

  it("skips the check entirely when no expected owner is given — the admin preview path", async () => {
    const summary = await getPayoutSummaryForTransfer(mockSupabase(), "transfer-1");
    expect(summary).not.toBeNull();
  });
});
