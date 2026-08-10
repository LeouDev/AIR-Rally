import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CourtCard, type VenueCardData } from "@/components/court/CourtCard";
import { toggleFavoriteAction } from "../../lib/actions/favorites";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/explore",
}));

// jest.mock must use a relative path here, not the `@/` alias — Jest's
// manual-mock resolver (a separate codepath from normal import resolution)
// breaks on the literal `:` in this repo's absolute path (`.../AIR:Rally`).
// Same class of issue as the Vitest resolver bug noted elsewhere; relative
// paths sidestep it.
jest.mock("../../lib/actions/favorites", () => ({
  toggleFavoriteAction: jest.fn(),
}));

const mockToggleFavoriteAction = toggleFavoriteAction as jest.MockedFunction<typeof toggleFavoriteAction>;

const venue: VenueCardData = {
  id: "test-1",
  name: "Test Pickle Club",
  city: "Cebu City",
  indoorOutdoor: "indoor",
  averageRating: 4.8,
  reviewCount: 42,
  startingPrice: 500,
};

describe("CourtCard", () => {
  beforeEach(() => {
    mockToggleFavoriteAction.mockReset();
  });

  it("renders venue details and links to its detail page", () => {
    render(<CourtCard venue={venue} />);

    expect(screen.getByText("Test Pickle Club")).toBeInTheDocument();
    expect(screen.getByText("Cebu City")).toBeInTheDocument();
    expect(screen.getByText("₱500")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Test Pickle Club/ })).toHaveAttribute(
      "href",
      "/courts/test-1"
    );
  });

  it("shows unavailable pricing when the venue has no active courts", () => {
    render(<CourtCard venue={{ ...venue, startingPrice: null }} />);
    expect(screen.getByText("Pricing unavailable")).toBeInTheDocument();
  });

  it("optimistically toggles favorite state when the favorite button is clicked", async () => {
    mockToggleFavoriteAction.mockResolvedValue({ success: true, data: { isFavorited: true } });
    const user = userEvent.setup();
    render(<CourtCard venue={venue} isFavorited={false} />);

    const favoriteButton = screen.getByRole("button", { name: "Save Test Pickle Club to favorites" });
    expect(favoriteButton).toHaveAttribute("aria-pressed", "false");

    await user.click(favoriteButton);

    expect(
      await screen.findByRole("button", { name: "Remove Test Pickle Club from favorites" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(mockToggleFavoriteAction).toHaveBeenCalledWith("test-1", false);
  });

  it("reverts the optimistic update when the toggle action fails", async () => {
    mockToggleFavoriteAction.mockResolvedValue({ success: false, error: "Sign in to save favorites." });
    const user = userEvent.setup();
    render(<CourtCard venue={venue} isFavorited={false} />);

    const favoriteButton = screen.getByRole("button", { name: "Save Test Pickle Club to favorites" });
    await user.click(favoriteButton);

    expect(
      await screen.findByRole("button", { name: "Save Test Pickle Club to favorites" })
    ).toHaveAttribute("aria-pressed", "false");
  });
});
