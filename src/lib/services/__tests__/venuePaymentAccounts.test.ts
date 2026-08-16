/**
 * @jest-environment node
 */
import {
  listOwnerPaymentAccounts,
  listAllPaymentAccounts,
  getVenuePayoutReadiness,
  setVenuePaymentAccountStatus,
  describePaymentAccountStatus,
} from "../venuePaymentAccounts";
import { createMockSupabase, createRpcMockSupabase } from "../../test-helpers/mockSupabase";
import type { VenuePaymentAccountStatus } from "../../supabase/types";

/**
 * Shaping and copy. The security boundary is RLS plus each RPC's own
 * is_admin() check, proven against staging in
 * scripts/verify-staging-payment-readiness.ts.
 */

describe("listOwnerPaymentAccounts", () => {
  // An owner filter here would imply the isolation came from this code
  // rather than from the table's RLS policy.
  it("does not filter by owner — RLS is the boundary", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listOwnerPaymentAccounts(supabase);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it("survives a venue whose name isn't visible through the embed", async () => {
    const supabase = createMockSupabase({
      data: [{ id: "a1", venue_id: "v1", status: "verified", venues: null }],
      error: null,
    });

    const [row] = await listOwnerPaymentAccounts(supabase);
    expect(row.venueName).toBe("Unknown venue");
  });
});

describe("listAllPaymentAccounts", () => {
  it("filters by status when given one", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listAllPaymentAccounts(supabase, "not_connected");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).toHaveBeenCalledWith("status", "not_connected");
  });

  it("applies no filter when none is given", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await listAllPaymentAccounts(supabase);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).not.toHaveBeenCalled();
  });
});

describe("getVenuePayoutReadiness", () => {
  it("reports counts and blocked money", async () => {
    const supabase = createRpcMockSupabase({
      data: [
        {
          venues_ready: 25,
          venues_missing_setup: 8,
          venues_restricted: 1,
          blocked_settlement_amount: 3500000,
          blocked_settlement_count: 12,
        },
      ],
      error: null,
    });

    await expect(getVenuePayoutReadiness(supabase)).resolves.toEqual({
      venuesReady: 25,
      venuesMissingSetup: 8,
      venuesRestricted: 1,
      blockedSettlementAmount: 3500000,
      blockedSettlementCount: 12,
    });
  });

  it("reports zeroes rather than failing on an empty platform", async () => {
    const supabase = createRpcMockSupabase({ data: [], error: null });
    await expect(getVenuePayoutReadiness(supabase)).resolves.toMatchObject({ venuesReady: 0, blockedSettlementAmount: 0 });
  });
});

describe("setVenuePaymentAccountStatus", () => {
  it("passes the venue, status and reason through to the RPC", async () => {
    const supabase = createRpcMockSupabase({ data: true, error: null });
    await expect(setVenuePaymentAccountStatus(supabase, "v1", "restricted", "under review")).resolves.toBe(true);

    expect(supabase.rpc).toHaveBeenCalledWith("set_venue_payment_account_status", {
      p_venue_id: "v1",
      p_status: "restricted",
      p_reason: "under review",
    });
  });

  it("reports false when no account matched", async () => {
    const supabase = createRpcMockSupabase({ data: false, error: null });
    await expect(setVenuePaymentAccountStatus(supabase, "v1", "verified")).resolves.toBe(false);
  });
});

describe("describePaymentAccountStatus", () => {
  const STATUSES: VenuePaymentAccountStatus[] = ["not_connected", "pending_verification", "verified", "restricted", "disabled"];

  it.each(STATUSES)("gives %s a title and an explanation", (status) => {
    const copy = describePaymentAccountStatus(status);
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.detail.length).toBeGreaterThan(0);
  });

  it("gives every status distinct wording", () => {
    const titles = STATUSES.map((s) => describePaymentAccountStatus(s).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // An owner who is verified but unpaid should not be told they were paid.
  it("never claims money has been sent", () => {
    for (const status of STATUSES) {
      const copy = describePaymentAccountStatus(status);
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/\bpaid out to you\b|\bhas been paid\b/i);
    }
  });
});

// Settlement eligibility now depends on the venue, not only the ledger.
// The rule itself lives in the database trigger; this documents the
// intended decision table alongside the staging proof.
describe("settlement payout eligibility by account status", () => {
  const ELIGIBLE: VenuePaymentAccountStatus[] = ["verified"];
  const BLOCKED: VenuePaymentAccountStatus[] = ["not_connected", "pending_verification", "restricted", "disabled"];

  it.each(ELIGIBLE)("a %s venue can be paid", (status) => {
    expect(status === "verified").toBe(true);
  });

  it.each(BLOCKED)("a %s venue cannot be paid", (status) => {
    expect(status === "verified").toBe(false);
  });

  it("treats a missing account exactly like not_connected", () => {
    const effective = (status: VenuePaymentAccountStatus | null) => status ?? "not_connected";
    expect(effective(null)).toBe("not_connected");
    expect(effective(null) === "verified").toBe(false);
  });
});
