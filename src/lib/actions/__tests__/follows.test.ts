/**
 * @jest-environment node
 */
import { toggleFollowAction } from "../follows";
import { getServerClient } from "../auth";
import { follow, unfollow } from "../../services/follows";

// Relative paths, not the `@/` alias — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({
  getServerClient: jest.fn(),
}));
jest.mock("../../services/follows", () => ({
  follow: jest.fn(),
  unfollow: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockFollow = follow as jest.MockedFunction<typeof follow>;
const mockUnfollow = unfollow as jest.MockedFunction<typeof unfollow>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockFollow.mockReset();
  mockUnfollow.mockReset();
});

describe("toggleFollowAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await toggleFollowAction("user-2", false);
    expect(result).toEqual({ success: false, error: "Sign in to follow players." });
    expect(mockFollow).not.toHaveBeenCalled();
  });

  it("rejects self-follow at the action layer, before ever reaching the DB CHECK constraint", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleFollowAction("user-1", false);
    expect(result).toEqual({ success: false, error: "You can't follow yourself." });
    expect(mockFollow).not.toHaveBeenCalled();
  });

  it("follows when not currently following", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleFollowAction("user-2", false);
    expect(mockFollow).toHaveBeenCalledWith(expect.anything(), "user-1", "user-2");
    expect(result).toEqual({ success: true, data: { following: true } });
  });

  it("unfollows when currently following", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleFollowAction("user-2", true);
    expect(mockUnfollow).toHaveBeenCalledWith(expect.anything(), "user-1", "user-2");
    expect(result).toEqual({ success: true, data: { following: false } });
  });
});
