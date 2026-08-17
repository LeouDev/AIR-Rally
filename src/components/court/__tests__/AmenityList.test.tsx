import { render, screen, within } from "@testing-library/react";
import { AmenityList } from "@/components/court/AmenityList";
import type { Amenity } from "@/lib/supabase/types";

function amenity(id: string, name: string): Amenity {
  return { id, name, icon: null } as Amenity;
}

const SHOWERS = amenity("a1", "Showers");
const PARKING = amenity("a2", "Free Parking");
const LIGHTS = amenity("a3", "Night Lighting");
const CATALOGUE = [SHOWERS, PARKING, LIGHTS];

describe("AmenityList", () => {
  it("lists what the venue lacks alongside what it has", () => {
    render(<AmenityList amenities={[PARKING]} catalogue={CATALOGUE} />);

    // The absence is the point: "no showers" has to be distinguishable from
    // "nobody filled this in", and only appears if it is rendered at all.
    expect(screen.getByText("Showers")).toBeInTheDocument();
    expect(screen.getByText("Free Parking")).toBeInTheDocument();
    expect(screen.getByText("Night Lighting")).toBeInTheDocument();
  });

  it("marks absences for assistive tech, not by colour alone", () => {
    render(<AmenityList amenities={[PARKING]} catalogue={CATALOGUE} />);

    const showers = screen.getByText("Showers").closest("li")!;
    const parking = screen.getByText("Free Parking").closest("li")!;

    expect(within(showers).getByText("not available")).toBeInTheDocument();
    expect(within(parking).queryByText("not available")).not.toBeInTheDocument();
  });

  it("dims absences rather than striking them through", () => {
    render(<AmenityList amenities={[PARKING]} catalogue={CATALOGUE} />);
    const showers = screen.getByText("Showers").closest("li")!;

    // A strikethrough reads as "removed" — a claim about history, not about
    // what is there today.
    expect(showers.className).toContain("text-placeholder");
    expect(showers.className).not.toMatch(/line-through/);
  });

  it("renders strictly against the catalogue, never a union with the venue's own rows", () => {
    const offCatalogue = amenity("rogue", "Helipad");
    render(<AmenityList amenities={[PARKING, offCatalogue]} catalogue={CATALOGUE} />);

    // One venue carrying an amenity outside the known list must not widen the
    // grid for that venue alone — the absences would stop being comparable
    // between pages.
    expect(screen.queryByText("Helipad")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(CATALOGUE.length);
  });

  it("falls back to the venue's own amenities when no catalogue is supplied", () => {
    render(<AmenityList amenities={[PARKING]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("not available")).not.toBeInTheDocument();
  });

  it("says so plainly when there is nothing to show", () => {
    render(<AmenityList amenities={[]} catalogue={[]} />);
    expect(screen.getByText("No amenities listed yet.")).toBeInTheDocument();
  });
});
