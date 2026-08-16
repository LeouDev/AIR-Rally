import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileActionsMenu } from "../ProfileActionsMenu";
import type { Profile } from "@/lib/supabase/types";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("../ProfileForm", () => ({
  ProfileForm: () => <div data-testid="profile-form">profile form</div>,
}));

const profile: Profile = {
  id: "user-1",
  first_name: "Lea",
  last_name: "Santos",
  display_name: "Lea Santos",
  avatar_url: null,
  phone: null,
  role: "player",
  owner_status: "none",
  referral_code: "ABCD1234",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("ProfileActionsMenu", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders three buttons instead of the account-details form", () => {
    render(<ProfileActionsMenu profile={profile} email="lea@example.com" />);
    expect(screen.getByRole("button", { name: /Account Settings/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /COURT\/Side/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play/ })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-form")).not.toBeInTheDocument();
  });

  it("opens the account-details form in a dialog when Account Settings is clicked", async () => {
    render(<ProfileActionsMenu profile={profile} email="lea@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: /Account Settings/ }));
    expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account settings" })).toBeInTheDocument();
  });

  it("routes to /court-side when COURT/Side is clicked", async () => {
    render(<ProfileActionsMenu profile={profile} email="lea@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: /COURT\/Side/ }));
    expect(mockPush).toHaveBeenCalledWith("/court-side");
  });

  it("routes to /explore when Play is clicked", async () => {
    render(<ProfileActionsMenu profile={profile} email="lea@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(mockPush).toHaveBeenCalledWith("/explore");
  });
});
