import {
  RankedError,
  ensureMyPlayerRank,
  createRankedMatch,
  submitResult,
  respondToResult,
} from "@/lib/services/ranked";
import { createRpcMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";

describe("RankedError mapping", () => {
  it("surfaces the AR001 message verbatim as a RankedError", async () => {
    const supabase = createRpcMockSupabase({
      data: null,
      error: postgrestError("AR001", "Party rank difference too large — ranked parties span at most three tiers."),
    });

    await expect(
      createRankedMatch(supabase, { matchType: "singles", teamA: ["a"], teamB: ["b"] })
    ).rejects.toThrow(RankedError);
    await expect(
      createRankedMatch(supabase, { matchType: "singles", teamA: ["a"], teamB: ["b"] })
    ).rejects.toThrow("Party rank difference too large — ranked parties span at most three tiers.");
  });

  it("rethrows a non-rule PostgrestError as-is, not as a RankedError", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: postgrestError("42501", "permission denied") });

    const failure = submitResult(supabase, "match-1");
    await expect(failure).rejects.not.toThrow(RankedError);
    await expect(failure).rejects.toMatchObject({ code: "42501" });
  });

  it("resolves normally when the RPC succeeds", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: null });
    await expect(ensureMyPlayerRank(supabase, "singles")).resolves.toBeUndefined();
  });

  it("passes the dispute reason through respond_ranked_result when rejecting", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: null });
    await respondToResult(supabase, "match-1", false, "Wrong winner");
    expect(supabase.rpc).toHaveBeenCalledWith("respond_ranked_result", {
      p_match_id: "match-1",
      p_accept: false,
      p_reason: "Wrong winner",
    });
  });
});

describe("createRankedMatch", () => {
  it("returns the new match id from the RPC", async () => {
    const supabase = createRpcMockSupabase({ data: "match-42", error: null });
    await expect(
      createRankedMatch(supabase, { matchType: "doubles", teamA: ["a", "b"], teamB: ["c", "d"], eventId: "evt-1" })
    ).resolves.toBe("match-42");
    expect(supabase.rpc).toHaveBeenCalledWith("create_ranked_match", {
      p_match_type: "doubles",
      p_team_a: ["a", "b"],
      p_team_b: ["c", "d"],
      p_event_id: "evt-1",
      p_court_id: null,
    });
  });
});
