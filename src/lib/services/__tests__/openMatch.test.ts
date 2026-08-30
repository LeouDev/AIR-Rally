import { getPublicOpenMatch } from "@/lib/services/openMatch";
import { createQueryBuilder, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * get_open_match_public() (migration 20260810000118) via .rpc().single()
 * — same shape as venueRequests.test.ts's getPublicVenueRequestSummary
 * coverage, since the shared mock helpers don't chain .single(). This
 * service also reads `cities` directly for the display name the RPC
 * doesn't resolve, so the mock needs both `rpc` and `from`.
 */
function mockSupabase(
  rpcResult: { data: unknown; error: unknown },
  cityResult: { data: unknown; error: PostgrestError | null } = { data: null, error: null }
) {
  return {
    rpc: jest.fn(() => ({ single: () => Promise.resolve(rpcResult) })),
    from: jest.fn(() => createQueryBuilder(cityResult)),
  } as unknown as SupabaseClient<Database>;
}

const ROW = {
  host_display_name: "Lea Santos",
  host_avatar_url: null,
  target_city: "quezon-city",
  status: "open",
  accepted_count: 2,
};

describe("getPublicOpenMatch", () => {
  it("maps a real row and resolves the city's display name, not the raw slug", async () => {
    const supabase = mockSupabase({ data: ROW, error: null }, { data: { display_name: "Quezon City" }, error: null });

    await expect(getPublicOpenMatch(supabase, "match-1")).resolves.toEqual({
      hostDisplayName: "Lea Santos",
      hostAvatarUrl: null,
      cityDisplayName: "Quezon City",
      status: "open",
      acceptedCount: 2,
    });
  });

  it("falls back to the raw slug if the city lookup comes back empty", async () => {
    const supabase = mockSupabase({ data: ROW, error: null }, { data: null, error: null });

    const result = await getPublicOpenMatch(supabase, "match-1");
    expect(result?.cityDisplayName).toBe("quezon-city");
  });

  it("returns null for an id matching no row — the only 'no such match' case", async () => {
    const supabase = mockSupabase({ data: null, error: { message: "No rows found", code: "PGRST116" } });

    await expect(getPublicOpenMatch(supabase, "00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("still throws a genuine error rather than swallowing it", async () => {
    const supabase = mockSupabase({ data: null, error: postgrestError("08006", "connection lost") });

    await expect(getPublicOpenMatch(supabase, "match-1")).rejects.toBeTruthy();
  });

  it("returns data for a non-open status — converted/expired/cancelled are not 404s", async () => {
    const supabase = mockSupabase(
      { data: { ...ROW, status: "converted" }, error: null },
      { data: { display_name: "Quezon City" }, error: null }
    );

    const result = await getPublicOpenMatch(supabase, "match-1");
    expect(result?.status).toBe("converted");
  });

  it("normalizes an unrecognised status to 'unknown' instead of passing it through raw or throwing", async () => {
    // The column is a plain CHECK-constrained TEXT, not a Postgres enum —
    // this simulates a value the client build has never seen, the same
    // class of bug new-enum-value-breaks-old-clients describes one layer
    // down. Must render as a safe unknown state, never crash.
    const supabase = mockSupabase(
      { data: { ...ROW, status: "some_future_status" }, error: null },
      { data: { display_name: "Quezon City" }, error: null }
    );

    const result = await getPublicOpenMatch(supabase, "match-1");
    expect(result?.status).toBe("unknown");
  });
});
