import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FavoriteButton } from "../FavoriteButton";
import { toggleFavoriteAction } from "../../../lib/actions/favorites";
import { toast } from "sonner";

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../lib/actions/favorites", () => ({
  toggleFavoriteAction: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => "/courts/venue-1",
}));

const mockToggleFavorite = toggleFavoriteAction as jest.MockedFunction<typeof toggleFavoriteAction>;

describe("FavoriteButton", () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset();
    mockPush.mockReset();
    mockRefresh.mockReset();
    (toast.error as jest.Mock).mockReset();
  });

  it("renders the unfavorited state", () => {
    render(<FavoriteButton venueId="venue-1" venueName="Banilad Pickle Club" initialFavorited={false} />);
    const button = screen.getByRole("button", { name: "Save Banilad Pickle Club to favorites" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the favorited state", () => {
    render(<FavoriteButton venueId="venue-1" venueName="Banilad Pickle Club" initialFavorited={true} />);
    const button = screen.getByRole("button", { name: "Remove Banilad Pickle Club from favorites" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("optimistically toggles and calls toggleFavoriteAction with the previous state", async () => {
    mockToggleFavorite.mockResolvedValue({ success: true, data: { isFavorited: true } });

    render(<FavoriteButton venueId="venue-1" venueName="Banilad Pickle Club" initialFavorited={false} />);
    const button = screen.getByRole("button", { name: "Save Banilad Pickle Club to favorites" });
    await userEvent.click(button);

    expect(mockToggleFavorite).toHaveBeenCalledWith("venue-1", false);
    expect(screen.getByRole("button", { name: "Remove Banilad Pickle Club from favorites" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("reverts the optimistic toggle and shows a toast on failure", async () => {
    mockToggleFavorite.mockResolvedValue({ success: false, error: "We couldn't update your favorites." });

    render(<FavoriteButton venueId="venue-1" venueName="Banilad Pickle Club" initialFavorited={false} />);
    const button = screen.getByRole("button", { name: "Save Banilad Pickle Club to favorites" });
    await userEvent.click(button);

    expect(screen.getByRole("button", { name: "Save Banilad Pickle Club to favorites" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(toast.error).toHaveBeenCalledWith("We couldn't update your favorites.");
  });

  it("shows a 'Sign in' toast action for an auth-error failure, without reaching for router.refresh", async () => {
    mockToggleFavorite.mockResolvedValue({ success: false, error: "Sign in to save favorites." });

    render(<FavoriteButton venueId="venue-1" venueName="Banilad Pickle Club" initialFavorited={false} />);
    const button = screen.getByRole("button", { name: "Save Banilad Pickle Club to favorites" });
    await userEvent.click(button);

    expect(toast.error).toHaveBeenCalledWith(
      "Sign in to save favorites.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Sign in" }) })
    );
    expect(mockRefresh).not.toHaveBeenCalled();

    const call = (toast.error as jest.Mock).mock.calls[0];
    call[1].action.onClick();
    expect(mockPush).toHaveBeenCalledWith("/login?redirect=%2Fcourts%2Fvenue-1");
  });
});
