import { render, screen, waitFor } from "@testing-library/react";
import { MobileNav } from "../MobileNav";
import { createClient } from "../../../lib/supabase/client";
import { getProfile } from "../../../lib/services/profiles";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
jest.mock("../../../lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("../../../lib/services/profiles", () => ({ getProfile: jest.fn() }));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockGetProfile = getProfile as jest.MockedFunction<typeof getProfile>;

function fakeSupabase(user: { id: string } | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user } }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  } as never;
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetProfile.mockReset();
});

describe("MobileNav", () => {
  it("shows the player tab bar (Favorites, no Owner tab) when signed out", async () => {
    mockCreateClient.mockReturnValue(fakeSupabase(null));
    render(<MobileNav />);

    expect(await screen.findByRole("link", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("shows the player tab bar for a player", async () => {
    mockCreateClient.mockReturnValue(fakeSupabase({ id: "user-1" }));
    mockGetProfile.mockResolvedValue({ role: "player" } as never);
    render(<MobileNav />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("swaps Favorites for an Owner tab for a venue_owner", async () => {
    mockCreateClient.mockReturnValue(fakeSupabase({ id: "user-1" }));
    mockGetProfile.mockResolvedValue({ role: "venue_owner" } as never);
    render(<MobileNav />);

    expect(await screen.findByRole("link", { name: "Owner" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Favorites" })).not.toBeInTheDocument();
  });

  it("swaps Favorites for an Owner tab for an admin", async () => {
    mockCreateClient.mockReturnValue(fakeSupabase({ id: "admin-1" }));
    mockGetProfile.mockResolvedValue({ role: "admin" } as never);
    render(<MobileNav />);

    expect(await screen.findByRole("link", { name: "Owner" })).toBeInTheDocument();
  });
});
