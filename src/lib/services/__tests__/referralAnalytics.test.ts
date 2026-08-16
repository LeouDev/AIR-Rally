/**
 * @jest-environment node
 */
import { getReferralFunnelStats } from "../referralAnalytics";
import { createMockSupabase } from "../../test-helpers/mockSupabase";

describe("getReferralFunnelStats", () => {
  it("groups counts by status and computes the invite-to-approved conversion rate", async () => {
    const rows = [
      { status: "sent" },
      { status: "started" },
      { status: "started" },
      { status: "completed" },
      { status: "approved" },
      { status: "approved" },
    ];
    const supabase = createMockSupabase({ data: rows, error: null });

    await expect(getReferralFunnelStats(supabase)).resolves.toEqual({
      sent: 1,
      started: 2,
      completed: 1,
      approved: 2,
      total: 6,
      conversionRate: 2 / 6,
    });
  });

  it("returns an all-zero funnel with a 0 rate when there are no referrals", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(getReferralFunnelStats(supabase)).resolves.toEqual({
      sent: 0,
      started: 0,
      completed: 0,
      approved: 0,
      total: 0,
      conversionRate: 0,
    });
  });

  it("ignores an unrecognized status rather than throwing, but still counts it in the total", async () => {
    const supabase = createMockSupabase({ data: [{ status: "some_future_status" }, { status: "approved" }], error: null });
    const stats = await getReferralFunnelStats(supabase);
    expect(stats.total).toBe(2);
    expect(stats.approved).toBe(1);
  });
});
