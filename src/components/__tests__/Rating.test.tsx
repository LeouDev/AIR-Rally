import { render, screen } from "@testing-library/react";
import { Rating } from "@/components/court/Rating";

describe("Rating", () => {
  it("renders the formatted value and review count", () => {
    render(<Rating value={4.876} reviewCount={214} />);
    expect(screen.getByText("4.9")).toBeInTheDocument();
    expect(screen.getByText("(214)")).toBeInTheDocument();
  });

  it("exposes an accessible label describing the rating", () => {
    render(<Rating value={4.5} reviewCount={10} />);
    expect(
      screen.getByLabelText("Rated 4.5 out of 5 from 10 reviews")
    ).toBeInTheDocument();
  });

  it("omits the review count when not provided", () => {
    render(<Rating value={5} />);
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
  });
});
