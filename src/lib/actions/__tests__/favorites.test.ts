/**
 * @jest-environment node
 *
 * Runs under the node test environment (not jsdom) because this module
 * transitively imports next/cache, which needs Web-standard globals
 * (Request/Response) jsdom doesn't provide. See the jest.mock note below
 * for the other environment-specific gotcha in this file.
 */
import { toggleFavoriteAction } from "../favorites";
import { getServerClient } from "../auth";
import { addFavorite, removeFavorite } from "../../services/favorites";

// Relative paths, not the `@/` alias — jest.mock's manual-mock resolver
// breaks on the literal `:` in this repo's absolute path
// (.../AIR:Rally). See MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({
  getServerClient: jest.fn(),
}));
jest.mock("../../services/favorites", () => ({
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
}));
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockAddFavorite = addFavorite as jest.MockedFunction<typeof addFavorite>;
const mockRemoveFavorite = removeFavorite as jest.MockedFunction<typeof removeFavorite>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

describe("toggleFavoriteAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockAddFavorite.mockReset();
    mockRemoveFavorite.mockReset();
  });

  it("asks an unauthenticated caller to sign in instead of touching the database", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });

    const result = await toggleFavoriteAction("venue-1", false);

    expect(result).toEqual({ success: false, error: "Sign in to save favorites." });
    expect(mockAddFavorite).not.toHaveBeenCalled();
  });

  it("surfaces a getServerClient failure (e.g. missing env config) without calling the service", async () => {
    mockGetServerClient.mockResolvedValue({ ok: false, error: "Sign-in isn't set up yet." });

    const result = await toggleFavoriteAction("venue-1", false);

    expect(result).toEqual({ success: false, error: "Sign-in isn't set up yet." });
    expect(mockAddFavorite).not.toHaveBeenCalled();
  });

  it("adds a favorite for an authenticated user and reports the new state", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockAddFavorite.mockResolvedValue(undefined);

    const result = await toggleFavoriteAction("venue-1", false);

    expect(result).toEqual({ success: true, data: { isFavorited: true } });
    expect(mockAddFavorite).toHaveBeenCalledWith(expect.anything(), "user-1", "venue-1");
    expect(mockRemoveFavorite).not.toHaveBeenCalled();
  });

  it("removes a favorite when it was already favorited", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockRemoveFavorite.mockResolvedValue(undefined);

    const result = await toggleFavoriteAction("venue-1", true);

    expect(result).toEqual({ success: true, data: { isFavorited: false } });
    expect(mockRemoveFavorite).toHaveBeenCalledWith(expect.anything(), "user-1", "venue-1");
  });

  it("maps a thrown service error to a friendly message instead of leaking it", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockAddFavorite.mockRejectedValue(new Error("permission denied for table favorites"));

    const result = await toggleFavoriteAction("venue-1", false);

    expect(result).toEqual({ success: false, error: "We couldn't update your favorites." });
  });
});
