import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CourtCard } from "@/components/court/CourtCard";
import type { Court } from "@/types/court";

const court: Court = {
  id: "test-1",
  slug: "test-court",
  name: "Test Pickle Club",
  tagline: "A great place to play",
  description: "Description",
  city: "Cebu City",
  area: "Banilad",
  address: "123 Test St",
  rating: 4.8,
  reviewCount: 42,
  pricePerHour: 500,
  courtType: "indoor",
  numberOfCourts: 4,
  surfaceType: "Cushioned Acrylic",
  amenityIds: [],
  images: [{ surfaceColor: "blue", indoor: true }],
  availability: [],
  featured: true,
};

describe("CourtCard", () => {
  it("renders court details and links to its detail page", () => {
    render(<CourtCard court={court} />);

    expect(screen.getByText("Test Pickle Club")).toBeInTheDocument();
    expect(screen.getByText("Banilad, Cebu City")).toBeInTheDocument();
    expect(screen.getByText("₱500")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Test Pickle Club/ })).toHaveAttribute(
      "href",
      "/courts/test-1"
    );
  });

  it("toggles favorite state when the favorite button is clicked", async () => {
    const user = userEvent.setup();
    render(<CourtCard court={court} />);

    const favoriteButton = screen.getByRole("button", { name: "Save Test Pickle Club to favorites" });
    expect(favoriteButton).toHaveAttribute("aria-pressed", "false");

    await user.click(favoriteButton);
    expect(
      screen.getByRole("button", { name: "Remove Test Pickle Club from favorites" })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
