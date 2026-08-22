import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { listFeedPosts, listLikedPostIds, listResharedPostIds } from "../../../lib/services/posts";
import { CourtSideFeed } from "../CourtSideFeed";

/**
 * COURT/Side's tabs must never claim to have changed a feed they did
 * not. This component used to lie about it: switching tabs popped a
 * "<tab> feed selected" toast over a feed nothing had filtered, because
 * court_side_feed() (lib/services/posts.ts) had no scope parameter at
 * all. Mobile found and fixed the identical bug first — see its
 * court-side/index.tsx and court-side-tabs.test.tsx.
 *
 * 'Near you' is removed rather than left quiet: it needs a device
 * location the web client has no standing way to ask for, so a tab that
 * can never do its job should not be offered.
 *
 * 'Following' is now real: switching to it refetches with the RPC's
 * p_scope (migration 20260810000077), so a tab switch is a genuine
 * network call, not a decorative selection change. NOT YET SAFE TO SHIP
 * — 077 is live on staging only, not production; see the comment on
 * listFeedPosts. These tests exercise the client wiring in isolation
 * (listFeedPosts itself is mocked), so they don't depend on that gate.
 *
 * The toast assertion is on ANY toast call, not a specific string, so
 * the old lie cannot come back worded differently.
 */

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn() }) }));
jest.mock("../../../lib/supabase/client", () => ({ createClient: jest.fn(() => ({})) }));
jest.mock("../../../lib/services/posts", () => ({
  listFeedPosts: jest.fn(),
  listLikedPostIds: jest.fn(),
  listResharedPostIds: jest.fn(),
}));
jest.mock("../../../lib/services/profiles", () => ({ searchPublicProfiles: jest.fn() }));
jest.mock("../../../lib/services/clubs", () => ({
  searchClubs: jest.fn(),
  clubMentionHandle: (name: string) => name.replace(/\s+/g, ""),
}));
jest.mock("../../../lib/services/postImages", () => ({
  ...jest.requireActual("../../../lib/services/postImages"),
  uploadPostImages: jest.fn(),
}));
jest.mock("../../../lib/services/follows", () => ({
  listFollowerProfiles: jest.fn(),
  listFollowingProfiles: jest.fn(),
}));
jest.mock("../../../lib/actions/posts", () => ({
  createPostAction: jest.fn(),
  deletePostAction: jest.fn(),
  toggleLikeAction: jest.fn(),
  toggleReshareAction: jest.fn(),
}));
jest.mock("../../../lib/actions/follows", () => ({ toggleFollowAction: jest.fn() }));
jest.mock("../../../lib/actions/events", () => ({ toggleEventJoinAction: jest.fn() }));
// PostCard pulls in ReportButton -> a "use server" action file that
// imports next/cache, which needs Node's server-only Request global —
// absent in jsdom and irrelevant here, since every post list below is
// empty and PostCard never actually renders for these tests.
jest.mock("../PostCard", () => ({ PostCard: () => null, initialsFrom: () => "TP" }));

const mockListFeedPosts = listFeedPosts as jest.MockedFunction<typeof listFeedPosts>;
const mockListLikedPostIds = listLikedPostIds as jest.MockedFunction<typeof listLikedPostIds>;
const mockListResharedPostIds = listResharedPostIds as jest.MockedFunction<typeof listResharedPostIds>;

const PROPS = {
  currentUserId: "11111111-1111-1111-1111-111111111111",
  displayName: "Test Player",
  avatarUrl: null,
  isAdmin: false,
  initialPosts: [],
  initialNextCursor: null,
  initialLikedPostIds: [],
  initialFollowingIds: [],
  initialEvents: [],
  initialEventStatuses: {},
  initialFollowerCount: 0,
  initialFollowingCount: 0,
  initialResharedPostIds: [],
  clubMentions: {},
  myClubs: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListFeedPosts.mockResolvedValue({ posts: [], nextCursor: null });
  mockListLikedPostIds.mockResolvedValue([]);
  mockListResharedPostIds.mockResolvedValue([]);
});

describe("COURT/Side feed tabs", () => {
  it("does not offer a tab it cannot honour", () => {
    render(<CourtSideFeed {...PROPS} />);

    expect(screen.queryByText("Near you")).toBeNull();
    expect(screen.getByRole("tab", { name: "For you" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Following" })).toBeTruthy();
  });

  it("refetches with the RPC's own scope, and never claims via a toast", async () => {
    const user = userEvent.setup();
    render(<CourtSideFeed {...PROPS} />);

    await user.click(screen.getByRole("tab", { name: "Following" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Following" })).toHaveAttribute("aria-selected", "true");
    });
    // The real fetch that replaces the old decorative toast.
    expect(mockListFeedPosts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "following" }));
    // Nothing may claim the feed changed via a toast — and nothing failed
    // silently into the error path either, which would otherwise hide
    // behind this same assertion (toast.error is a distinct mock from
    // the bare toast() call the component used to make).
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not refetch when tapping the tab that is already active", async () => {
    const user = userEvent.setup();
    render(<CourtSideFeed {...PROPS} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "For you" })).toHaveAttribute("aria-selected", "true"));

    await user.click(screen.getByRole("tab", { name: "For you" }));

    expect(mockListFeedPosts).not.toHaveBeenCalled();
  });
});
