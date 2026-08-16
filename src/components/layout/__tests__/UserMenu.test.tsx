import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "../UserMenu";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("../../../lib/supabase/client", () => ({
  createClient: jest.fn(() => ({ auth: { signOut: jest.fn().mockResolvedValue({ error: null }) } })),
}));

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /Account menu for/i }));
}

describe("UserMenu", () => {
  it("shows only player-facing items for a player — no owner or admin links", async () => {
    render(<UserMenu displayName="Jamie" email="jamie@example.com" avatarUrl={null} role="player" />);
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Bookings/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Favorites/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /My Venues/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Venue Management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Owner Applications/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Payment Monitoring/i })).not.toBeInTheDocument();
  });

  it("shows 'My Venues' for a venue_owner, but no admin-only links", async () => {
    render(<UserMenu displayName="Jamie" email="jamie@example.com" avatarUrl={null} role="venue_owner" />);
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /My Venues/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Venue Management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Owner Applications/i })).not.toBeInTheDocument();
  });

  it("shows both owner and admin tools for an admin", async () => {
    render(<UserMenu displayName="Jamie" email="jamie@example.com" avatarUrl={null} role="admin" />);
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /My Venues/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Venue Management/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Owner Applications/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Payment Monitoring/i })).toBeInTheDocument();
  });
});
