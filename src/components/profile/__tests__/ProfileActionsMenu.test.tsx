import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileActionsMenu } from "../ProfileActionsMenu";
import type { Profile, UserRole } from "@/lib/supabase/types";

jest.mock("../ProfileForm", () => ({
  ProfileForm: () => <div data-testid="profile-form">profile form</div>,
}));

function makeProfile(role: UserRole = "player"): Profile {
  return {
    id: "user-1",
    first_name: "Lea",
    last_name: "Santos",
    display_name: "Lea Santos",
    avatar_url: null,
    phone: null,
    role,
    owner_status: "none",
    referral_code: "ABCD1234",
    email_notifications_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("ProfileActionsMenu", () => {
  // Navigation is real anchors now, not router.push on a button. That
  // matters beyond styling: links are middle-clickable, openable in a new
  // tab, and readable by assistive tech as navigation.
  it("renders navigation as links with real hrefs", () => {
    render(<ProfileActionsMenu profile={makeProfile()} email="lea@example.com" />);

    expect(screen.getByRole("link", { name: /COURT\/Side/ })).toHaveAttribute("href", "/court-side");
    expect(screen.getByRole("link", { name: /Clubs/ })).toHaveAttribute("href", "/clubs");
    expect(screen.getByRole("link", { name: /My bookings/ })).toHaveAttribute("href", "/bookings");
    expect(screen.getByRole("link", { name: /Find a court/ })).toHaveAttribute("href", "/explore");
  });

  it("keeps account settings a button, because it opens a dialog rather than navigating", () => {
    render(<ProfileActionsMenu profile={makeProfile()} email="lea@example.com" />);
    expect(screen.getByRole("button", { name: /Account settings/ })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-form")).not.toBeInTheDocument();
  });

  it("opens the account-details form in a dialog when account settings is clicked", async () => {
    render(<ProfileActionsMenu profile={makeProfile()} email="lea@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));

    expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account settings" })).toBeInTheDocument();
  });

  // A player seeing an "Admin" or "Venue dashboard" shortcut would be
  // offered a page they'd only bounce off.
  it("shows a player no admin or owner shortcut", () => {
    render(<ProfileActionsMenu profile={makeProfile("player")} email="lea@example.com" />);

    expect(screen.queryByRole("link", { name: /Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Venue dashboard/ })).not.toBeInTheDocument();
  });

  it("gives a venue owner a route to their dashboard", () => {
    render(<ProfileActionsMenu profile={makeProfile("venue_owner")} email="lea@example.com" />);

    expect(screen.getByRole("link", { name: /Venue dashboard/ })).toHaveAttribute("href", "/list-your-court/overview");
    expect(screen.queryByRole("link", { name: /Admin/ })).not.toBeInTheDocument();
  });

  // Previously an admin had no route to /admin from their own profile at all.
  it("gives an admin a route to the admin area", () => {
    render(<ProfileActionsMenu profile={makeProfile("admin")} email="lea@example.com" />);

    expect(screen.getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "/admin");
  });

  it("describes every shortcut, so none is just an unexplained icon", () => {
    render(<ProfileActionsMenu profile={makeProfile("admin")} email="lea@example.com" />);

    for (const name of [/COURT\/Side/, /Clubs/, /My bookings/, /Find a court/, /Admin/]) {
      // Title plus a sentence of explanation, not a bare label.
      const text = screen.getByRole("link", { name }).textContent ?? "";
      expect(text.length).toBeGreaterThan(30);
      expect(text).toMatch(/\.$/);
    }
  });
});
