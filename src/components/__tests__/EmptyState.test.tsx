import { render, screen } from "@testing-library/react";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";

describe("EmptyState", () => {
  it("renders the title, description, and optional action", () => {
    render(
      <EmptyState
        icon={Heart}
        title="No favorites yet"
        description="Save a court to see it here."
        action={<button>Browse Courts</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "No favorites yet" })).toBeInTheDocument();
    expect(screen.getByText("Save a court to see it here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse Courts" })).toBeInTheDocument();
  });

  it("renders without an action", () => {
    render(<EmptyState icon={Heart} title="Nothing here" description="Empty." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
