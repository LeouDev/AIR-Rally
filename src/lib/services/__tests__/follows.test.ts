import { follow, unfollow, listFollowingIds, getFollowCounts, listFollowerProfiles, listFollowingProfiles } from "@/lib/services/follows";
import { createMockSupabase, createTableMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { PublicProfile } from "@/lib/supabase/types";

describe("follow / unfollow", () => {
  it("is idempotent — a duplicate follow (unique violation) does not throw", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23505") });
    await expect(follow(supabase, "user-1", "user-2")).resolves.toBeUndefined();
  });

  it("propagates a genuine, unrelated database error — e.g. the self-follow CHECK constraint", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23514", "follows_no_self_follow") });
    await expect(follow(supabase, "user-1", "user-1")).rejects.toBeTruthy();
  });

  it("unfollowing is a plain delete, always resolves", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(unfollow(supabase, "user-1", "user-2")).resolves.toBeUndefined();
  });
});

describe("listFollowingIds", () => {
  it("returns all of a user's follows when no candidate list is given", async () => {
    const supabase = createMockSupabase({ data: [{ following_id: "user-2" }, { following_id: "user-3" }], error: null });
    await expect(listFollowingIds(supabase, "user-1")).resolves.toEqual(["user-2", "user-3"]);
  });

  it("returns an empty array without querying when candidateIds is an empty array", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(listFollowingIds(supabase, "user-1", [])).resolves.toEqual([]);
  });
});

describe("getFollowCounts", () => {
  it("defaults both counts to 0 when Supabase returns a null count", async () => {
    const supabase = createMockSupabase({ data: null, error: null, count: null });
    await expect(getFollowCounts(supabase, "user-1")).resolves.toEqual({ followers: 0, following: 0 });
  });
});

describe("listFollowerProfiles / listFollowingProfiles", () => {
  const AUTHOR: PublicProfile = { id: "user-2", display_name: "Lea Santos", avatar_url: null };

  it("listFollowerProfiles joins follower ids to their public profiles, preserving order", async () => {
    const supabase = createTableMockSupabase({
      follows: { data: [{ follower_id: "user-2" }], error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    await expect(listFollowerProfiles(supabase, "user-1")).resolves.toEqual([AUTHOR]);
  });

  it("listFollowingProfiles joins following ids to their public profiles", async () => {
    const supabase = createTableMockSupabase({
      follows: { data: [{ following_id: "user-2" }], error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    await expect(listFollowingProfiles(supabase, "user-1")).resolves.toEqual([AUTHOR]);
  });

  it("returns an empty array without a profiles lookup when there are no follows at all", async () => {
    const supabase = createTableMockSupabase({ follows: { data: [], error: null } });
    await expect(listFollowerProfiles(supabase, "user-1")).resolves.toEqual([]);
  });
});
