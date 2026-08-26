/**
 * @jest-environment node
 */
import { getPayoutBatchDetail } from "../payouts";

/**
 * Covers the per-venue transfer grouping — the shape an admin actually
 * acts on. A batch's settlements are per-booking; a bank transfer is
 * per-venue, and getting that collapse wrong means either paying a venue
 * once per booking or paying one venue another venue's total.
 *
 * Every fixture below has TWO venues on purpose. A single-venue batch
 * cannot distinguish "summed this venue's items" from "used the batch
 * total", because with one venue those are the same number — so a
 * one-venue test would pass against the bug it exists to catch.
 */

const BATCH = {
  id: "batch-1",
  batch_reference: "PB-000001",
  status: "approved",
  total_amount: 9000,
  settlement_count: 3,
};

/** Two venues: A with two settlements (₱40 + ₱20), B with one (₱30). */
const ITEMS = [
  {
    id: "i1",
    settlement_id: "s1",
    venue_id: "v-a",
    amount: 4000,
    venues: { name: "Venue A" },
    booking_settlements: { booking_id: "b1", currency: "PHP", bookings: { confirmation_code: "AAA111" } },
  },
  {
    id: "i2",
    settlement_id: "s2",
    venue_id: "v-a",
    amount: 2000,
    venues: { name: "Venue A" },
    booking_settlements: { booking_id: "b2", currency: "PHP", bookings: { confirmation_code: "AAA222" } },
  },
  {
    id: "i3",
    settlement_id: "s3",
    venue_id: "v-b",
    amount: 3000,
    venues: { name: "Venue B" },
    booking_settlements: { booking_id: "b3", currency: "PHP", bookings: { confirmation_code: "BBB111" } },
  },
];

const ACCOUNTS = [
  {
    venue_id: "v-a",
    bank_name: "BANK OF THE PHILIPPINE ISLANDS",
    bank_account_name: "Venue A Inc",
    bank_account_number: "1234567890",
  },
  { venue_id: "v-b", bank_name: null, bank_account_name: null, bank_account_number: null },
];

function mockSupabase(accounts = ACCOUNTS, items = ITEMS) {
  return {
    from: jest.fn((table: string) => {
      if (table === "payout_batches") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: BATCH, error: null }) })),
          })),
        };
      }
      if (table === "payout_batch_items") {
        return { select: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: items, error: null }) })) };
      }
      if (table === "venue_payment_accounts") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: accounts, error: null }) })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as Parameters<typeof getPayoutBatchDetail>[0];
}

describe("getPayoutBatchDetail — transfers", () => {
  it("collapses a venue's several settlements into one transfer", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(), "batch-1");
    expect(detail?.transfers).toHaveLength(2);
    expect(detail?.venueCount).toBe(2);
  });

  // The discriminating assertion: ₱60 is Venue A's own two items summed.
  // The batch total is ₱90, so a transfer built from batch.total_amount
  // would read 9000 here and this test would fail — which is the point.
  it("sums each venue's own items rather than reusing the batch total", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(), "batch-1");
    const a = detail?.transfers.find((t) => t.venueId === "v-a");
    const b = detail?.transfers.find((t) => t.venueId === "v-b");

    expect(a?.amount).toBe(6000);
    expect(b?.amount).toBe(3000);
    expect(BATCH.total_amount).toBe(9000);
    // And the parts must reconcile to the whole, or one venue is being
    // over- or under-paid without either number looking wrong alone.
    expect((a?.amount ?? 0) + (b?.amount ?? 0)).toBe(BATCH.total_amount);
  });

  it("counts the settlements behind each transfer", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(), "batch-1");
    expect(detail?.transfers.find((t) => t.venueId === "v-a")?.settlementCount).toBe(2);
    expect(detail?.transfers.find((t) => t.venueId === "v-b")?.settlementCount).toBe(1);
  });

  it("attaches each venue's own destination account, not another venue's", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(), "batch-1");
    const a = detail?.transfers.find((t) => t.venueId === "v-a");
    expect(a).toMatchObject({
      bankName: "BANK OF THE PHILIPPINE ISLANDS",
      bankAccountName: "Venue A Inc",
      bankAccountNumber: "1234567890",
      payable: true,
    });
  });

  // A venue with no destination must be surfaced as unpayable rather than
  // silently dropped: an admin who sees two rows and pays one knows work
  // remains; an admin shown one row thinks the batch is done.
  it("marks a venue with no bank details unpayable and still lists it", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(), "batch-1");
    const b = detail?.transfers.find((t) => t.venueId === "v-b");
    expect(b).toMatchObject({ payable: false, bankName: null, bankAccountNumber: null });
    expect(b?.amount).toBe(3000);
  });

  it("treats a venue with no payment account row at all as unpayable", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase([ACCOUNTS[0]]), "batch-1");
    expect(detail?.transfers.find((t) => t.venueId === "v-b")?.payable).toBe(false);
  });

  it("returns no transfers for an empty batch rather than throwing", async () => {
    const detail = await getPayoutBatchDetail(mockSupabase(ACCOUNTS, []), "batch-1");
    expect(detail?.transfers).toEqual([]);
    expect(detail?.venueCount).toBe(0);
  });
});
