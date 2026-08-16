/**
 * @jest-environment node
 */
import {
  listDiscoverableClubs,
  listClubsForUser,
  getClubForViewer,
  listClubMembers,
  createClub,
  requestClubMembership,
  approveClubMember,
  setClubMemberRole,
  searchClubs,
  clubMentionHandle,
} from "../clubs";
import { createMockSupabase, createTableMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";
import type { Club, PublicProfile } from "@/lib/supabase/types";

const CLUB: Club = {
  id: "club-1",
  owner_id: "user-1",
  name: "Cebu Weekend Picklers",
  description: null,
  image_url: null,
  location: "Cebu City",
  skill_level: "mixed",
  club_type: "social",
  visibility: "public",
  status: "active",
  member_count: 3,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

const PROFILE: PublicProfile = { id: "user-2", display_name: "Lea Santos", avatar_url: null };

describe("listDiscoverableClubs", () => {
  it("returns active clubs — RLS, not this query, hides private ones", async () => {
    const supabase = createMockSupabase({ data: [CLUB], error: null });
    await expect(listDiscoverableClubs(supabase)).resolves.toEqual([CLUB]);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { eq: jest.Mock };
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });
});

describe("searchClubs", () => {
  it("returns an empty array without querying for a blank term", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(searchClubs(supabase, "   ")).resolves.toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("matches club names case-insensitively, scoped to active clubs", async () => {
    const supabase = createMockSupabase({ data: [CLUB], error: null });
    await expect(searchClubs(supabase, "weekend")).resolves.toEqual([CLUB]);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { ilike: jest.Mock; eq: jest.Mock };
    expect(builder.ilike).toHaveBeenCalledWith("name", "%weekend%");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });

  // Without escaping, typing "%" would match every club rather than
  // searching for a literal percent sign.
  it("escapes LIKE wildcards so they are searched literally", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await searchClubs(supabase, "50%_off");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { ilike: jest.Mock };
    expect(builder.ilike).toHaveBeenCalledWith("name", "%50\\%\\_off%");
  });
});

describe("clubMentionHandle", () => {
  // The feed highlighter matches "@" plus alphanumerics only, so a
  // multi-word club name has to collapse into a single token or only its
  // first word would be highlighted.
  it("collapses a multi-word club name into one mention token", () => {
    expect(clubMentionHandle("Cebu Weekend Picklers")).toBe("CebuWeekendPicklers");
  });

  it("strips punctuation and accents that the highlighter would break on", () => {
    expect(clubMentionHandle("Rally & Co. — Cebú")).toBe("RallyCoCeb");
  });

  it("preserves underscores and digits", () => {
    expect(clubMentionHandle("Court_9 Crew")).toBe("Court_9Crew");
  });
});

describe("listClubsForUser", () => {
  it("returns an empty array without a second query when the user has no memberships", async () => {
    const supabase = createTableMockSupabase({ club_members: { data: [], error: null } });
    await expect(listClubsForUser(supabase, "user-1")).resolves.toEqual([]);
  });

  it("resolves the user's active memberships into full club rows", async () => {
    const supabase = createTableMockSupabase({
      club_members: { data: [{ club_id: "club-1" }], error: null },
      clubs: { data: [CLUB], error: null },
    });
    await expect(listClubsForUser(supabase, "user-1")).resolves.toEqual([CLUB]);
  });
});

describe("getClubForViewer", () => {
  it("returns null for a club the viewer can't see (RLS) rather than throwing", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getClubForViewer(supabase, "club-1", "user-9")).resolves.toBeNull();
  });

  it("returns null (not an error) for a malformed club id", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("22P02") });
    await expect(getClubForViewer(supabase, "not-a-uuid", "user-1")).resolves.toBeNull();
  });

  it("reports no viewer role for a signed-out visitor", async () => {
    const supabase = createMockSupabase({ data: CLUB, error: null });
    const result = await getClubForViewer(supabase, "club-1", null);
    expect(result).toMatchObject({ viewerRole: null, viewerPending: false });
  });

  it("exposes the viewer's active role", async () => {
    const supabase = createTableMockSupabase({
      clubs: { data: CLUB, error: null },
      club_members: { data: { role: "admin", status: "active" }, error: null },
    });
    const result = await getClubForViewer(supabase, "club-1", "user-2");
    expect(result).toMatchObject({ viewerRole: "admin", viewerPending: false });
  });

  // A pending applicant is not a member yet — they must not be treated as
  // one, but they do need to see that their request is outstanding.
  it("reports a pending request as pending, not as a role", async () => {
    const supabase = createTableMockSupabase({
      clubs: { data: CLUB, error: null },
      club_members: { data: { role: "member", status: "pending" }, error: null },
    });
    const result = await getClubForViewer(supabase, "club-1", "user-3");
    expect(result).toMatchObject({ viewerRole: null, viewerPending: true });
  });

  it("does not treat a blocked member as having a role", async () => {
    const supabase = createTableMockSupabase({
      clubs: { data: CLUB, error: null },
      club_members: { data: { role: "member", status: "blocked" }, error: null },
    });
    const result = await getClubForViewer(supabase, "club-1", "user-4");
    expect(result).toMatchObject({ viewerRole: null, viewerPending: false });
  });
});

describe("listClubMembers", () => {
  it("joins the roster to display names through public_profiles", async () => {
    const supabase = createTableMockSupabase({
      club_members: { data: [{ club_id: "club-1", user_id: "user-2", role: "member", status: "active", created_at: "x" }], error: null },
      public_profiles: { data: [PROFILE], error: null },
    });
    const members = await listClubMembers(supabase, "club-1");
    expect(members[0].profile).toEqual(PROFILE);
  });

  it("returns an empty array without a profiles lookup for an empty roster", async () => {
    const supabase = createTableMockSupabase({ club_members: { data: [], error: null } });
    await expect(listClubMembers(supabase, "club-1")).resolves.toEqual([]);
  });
});

describe("createClub", () => {
  // The whole point of the feature: a plain player owns a community
  // without becoming a venue owner. Nothing here consults profiles.role.
  it("inserts with the caller as owner and never touches a platform role", async () => {
    const supabase = createMockSupabase({ data: CLUB, error: null });
    await createClub(supabase, "user-1", {
      name: "Cebu Weekend Picklers",
      skillLevel: "mixed",
      clubType: "social",
      visibility: "public",
    });

    const fromMock = supabase.from as jest.Mock;
    expect(fromMock).toHaveBeenCalledWith("clubs");
    expect(fromMock).not.toHaveBeenCalledWith("profiles");

    const builder = fromMock.mock.results[0].value as { insert: jest.Mock };
    const payload = builder.insert.mock.calls[0][0];
    expect(payload.owner_id).toBe("user-1");
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("member_count");
  });
});

describe("requestClubMembership", () => {
  // The trigger decides role/status from the club's visibility — the
  // service must not try to set them, or a caller could self-approve.
  it("sends only the club and user ids, never a role or status", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await requestClubMembership(supabase, "club-1", "user-2");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { insert: jest.Mock };
    expect(builder.insert.mock.calls[0][0]).toEqual({ club_id: "club-1", user_id: "user-2" });
  });

  it("is idempotent — re-requesting an existing membership does not throw", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23505") });
    await expect(requestClubMembership(supabase, "club-1", "user-2")).resolves.toBeUndefined();
  });

  it("propagates a genuine error, such as a private club rejecting the insert", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23514", "This club is invite only.") });
    await expect(requestClubMembership(supabase, "club-1", "user-2")).rejects.toBeTruthy();
  });
});

describe("approveClubMember / setClubMemberRole", () => {
  it("approval flips status to active for the named member only", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await approveClubMember(supabase, "club-1", "user-2");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock; eq: jest.Mock };
    expect(builder.update).toHaveBeenCalledWith({ status: "active" });
    expect(builder.eq).toHaveBeenCalledWith("club_id", "club-1");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-2");
  });

  it("role changes send only the role — the database reverts unauthorized ones", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await setClubMemberRole(supabase, "club-1", "user-2", "admin");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock };
    expect(builder.update).toHaveBeenCalledWith({ role: "admin" });
  });
});
