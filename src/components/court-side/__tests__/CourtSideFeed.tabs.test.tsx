import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { CourtSideFeed } from "../CourtSideFeed";

/**
 * COURT/Side's tabs must never claim to have changed a feed they did
 * not. The feed always comes from court_side_feed(p_limit, p_cursor) —
 * see lib/services/posts.ts — which has no scope parameter yet, so
 * every tab renders the same unfiltered feed. This component went
 * further than that gap and told the player otherwise: switching tabs
 * popped a "<tab> feed selected" toast over a feed nothing had
 * filtered. A missing feature is a gap; announcing it worked is a lie,
 * and only the lie was ours to fix from here. Mobile found and fixed
 * the identical bug first — see its court-side/index.tsx and
 * court-side-tabs.test.tsx.
 *
 * 'Near you' is removed rather than left quiet: it needs a device
 * location the web client has no standing way to ask for, so a tab
 * that can never do its job should not be offered.
 *
 * The toast assertion below is on ANY toast call, not on the specific
 * string that used to fire — so the claim cannot return worded
 * differently. When the RPC learns a scope parameter (migration
 * 20260810000077) and 'Following' becomes real, rewrite this against
 * the query the tab now produces rather than loosening it to let the
 * announcement back.
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
// absent in jsdom and irrelevant here, since initialPosts is empty and
// PostCard never actually renders for this test.
jest.mock("../PostCard", () => ({ PostCard: () => null, initialsFrom: () => "TP" }));

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
});

describe("COURT/Side feed tabs", () => {
  it("does not offer a tab it cannot honour", () => {
    render(<CourtSideFeed {...PROPS} />);

    expect(screen.queryByText("Near you")).toBeNull();
    expect(screen.getByRole("tab", { name: "For you" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Following" })).toBeTruthy();
  });

  it("moves the selection without claiming the feed changed", async () => {
    const user = userEvent.setup();
    render(<CourtSideFeed {...PROPS} />);

    await user.click(screen.getByRole("tab", { name: "Following" }));

    expect(screen.getByRole("tab", { name: "Following" })).toHaveAttribute("aria-selected", "true");
    // Nothing may claim the feed changed — no toast of any kind, not
    // just the specific string that used to fire.
    expect(toast).not.toHaveBeenCalled();
  });
});
