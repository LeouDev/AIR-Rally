/**
 * @jest-environment node
 */
import { createClubAction, joinClubAction, setClubMemberRoleAction, approveClubMemberAction } from "../clubs";
import { getServerClient } from "../auth";
import { createClub, requestClubMembership, setClubMemberRole, approveClubMember } from "../../services/clubs";

// Relative paths, not the `@/` alias — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({
  getServerClient: jest.fn(),
}));
jest.mock("../../services/clubs", () => ({
  createClub: jest.fn(),
  updateClub: jest.fn(),
  requestClubMembership: jest.fn(),
  leaveClub: jest.fn(),
  approveClubMember: jest.fn(),
  removeClubMember: jest.fn(),
  setClubMemberRole: jest.fn(),
}));
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateClub = createClub as jest.MockedFunction<typeof createClub>;
const mockRequestMembership = requestClubMembership as jest.MockedFunction<typeof requestClubMembership>;
const mockSetRole = setClubMemberRole as jest.MockedFunction<typeof setClubMemberRole>;
const mockApprove = approveClubMember as jest.MockedFunction<typeof approveClubMember>;

const CLUB_ID = "3fabfd53-6792-4b28-b9b4-8d31e0df5298";
const USER_ID = "8c1f5a2e-1d3b-4c7a-9e5f-2b8d6a4c0e11";

/** Minimal client stub: an auth user plus a chainable membership lookup. */
function fakeClient(user: { id: string } | null, membershipStatus?: string) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: membershipStatus ? { status: membershipStatus } : null, error: null }),
  };
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => builder),
  } as never;
}

const VALID_CLUB = {
  name: "Cebu Weekend Picklers",
  skillLevel: "mixed" as const,
  clubType: "social" as const,
  visibility: "public" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("createClubAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createClubAction(VALID_CLUB);
    expect(result).toEqual({ success: false, error: "Sign in to create a club." });
    expect(mockCreateClub).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching the database", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }) });
    const result = await createClubAction({ ...VALID_CLUB, name: "" });
    expect(result.success).toBe(false);
    expect(mockCreateClub).not.toHaveBeenCalled();
  });

  // The defining requirement of this feature: no venue_owner role needed.
  it("lets any signed-in account create a club, with no role gate", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }) });
    mockCreateClub.mockResolvedValue({ id: CLUB_ID } as never);

    const result = await createClubAction(VALID_CLUB);

    expect(result.success).toBe(true);
    expect(mockCreateClub).toHaveBeenCalledWith(expect.anything(), USER_ID, expect.objectContaining({ name: VALID_CLUB.name }));
  });
});

describe("joinClubAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await joinClubAction(CLUB_ID);
    expect(result).toEqual({ success: false, error: "Sign in to join a club." });
    expect(mockRequestMembership).not.toHaveBeenCalled();
  });

  it("reports an immediate join for a public club", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }, "active") });
    const result = await joinClubAction(CLUB_ID);
    expect(result).toEqual({ success: true, data: { pending: false } });
  });

  // The database decides — an approval_required club yields a pending row,
  // and the action must report that rather than claim membership.
  it("reports a pending request when the club requires approval", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }, "pending") });
    const result = await joinClubAction(CLUB_ID);
    expect(result).toEqual({ success: true, data: { pending: true } });
  });

  it("surfaces a friendly error when the club is invite only", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }) });
    mockRequestMembership.mockRejectedValue(new Error("This club is invite only."));
    const result = await joinClubAction(CLUB_ID);
    expect(result.success).toBe(false);
  });
});

describe("setClubMemberRoleAction", () => {
  // Ownership transfer is not a role change — it would desync
  // clubs.owner_id from the roster, so it is refused outright.
  it("refuses to assign the owner role", async () => {
    const result = await setClubMemberRoleAction(CLUB_ID, USER_ID, "owner");
    expect(result).toEqual({ success: false, error: "Club ownership can't be reassigned here." });
    expect(mockSetRole).not.toHaveBeenCalled();
  });

  it("passes a member/admin role change through to the service", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }) });
    const result = await setClubMemberRoleAction(CLUB_ID, USER_ID, "admin");
    expect(result.success).toBe(true);
    expect(mockSetRole).toHaveBeenCalledWith(expect.anything(), CLUB_ID, USER_ID, "admin");
  });
});

describe("approveClubMemberAction", () => {
  it("delegates to the service, relying on RLS to restrict who may approve", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: USER_ID }) });
    const result = await approveClubMemberAction(CLUB_ID, USER_ID);
    expect(result.success).toBe(true);
    expect(mockApprove).toHaveBeenCalledWith(expect.anything(), CLUB_ID, USER_ID);
  });
});
