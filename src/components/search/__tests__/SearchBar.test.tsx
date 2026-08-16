import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../SearchBar";
import { reverseGeocodeCity } from "../../../lib/services/geocoding";

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../lib/services/geocoding", () => ({
  reverseGeocodeCity: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockReverseGeocodeCity = reverseGeocodeCity as jest.MockedFunction<typeof reverseGeocodeCity>;

function mockGeolocation(behavior: "grant" | "deny" | "unsupported") {
  if (behavior === "unsupported") {
    Object.defineProperty(global.navigator, "geolocation", { value: undefined, configurable: true });
    return;
  }
  const getCurrentPosition = jest.fn((success: PositionCallback, error?: PositionErrorCallback) => {
    if (behavior === "grant") {
      success({ coords: { latitude: 10.3, longitude: 123.9 } } as GeolocationPosition);
    } else {
      error?.({} as GeolocationPositionError);
    }
  });
  Object.defineProperty(global.navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

describe("SearchBar", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReverseGeocodeCity.mockReset();
  });

  it("renders a free-text location field with a generic placeholder when geolocation is unavailable", () => {
    mockGeolocation("unsupported");
    render(<SearchBar />);
    expect(screen.getByLabelText("Where")).toHaveAttribute("placeholder", "City, municipality, or barangay");
  });

  it("upgrades the placeholder to the visitor's detected city on a granted geolocation permission", async () => {
    mockGeolocation("grant");
    mockReverseGeocodeCity.mockResolvedValue("Cebu City");

    render(<SearchBar />);

    await waitFor(() => expect(screen.getByLabelText("Where")).toHaveAttribute("placeholder", "Cebu City"));
  });

  it("keeps the generic placeholder when geolocation is denied", async () => {
    mockGeolocation("deny");
    render(<SearchBar />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByLabelText("Where")).toHaveAttribute("placeholder", "City, municipality, or barangay");
    expect(mockReverseGeocodeCity).not.toHaveBeenCalled();
  });

  it("lets a visitor type any free-text location and includes it verbatim in the search", async () => {
    mockGeolocation("unsupported");
    render(<SearchBar />);

    await userEvent.type(screen.getByLabelText("Where"), "Barangay Lahug");
    await userEvent.click(screen.getByRole("button", { name: "Find Courts" }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("location=Barangay+Lahug"));
  });

  it("falls back to the detected city when the field is left empty", async () => {
    mockGeolocation("grant");
    mockReverseGeocodeCity.mockResolvedValue("Cebu City");

    render(<SearchBar />);
    await waitFor(() => expect(screen.getByLabelText("Where")).toHaveAttribute("placeholder", "Cebu City"));

    await userEvent.click(screen.getByRole("button", { name: "Find Courts" }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("location=Cebu+City"));
  });

  it("omits the location param entirely when the field is empty and no city was detected", async () => {
    mockGeolocation("unsupported");
    render(<SearchBar />);

    await userEvent.click(screen.getByRole("button", { name: "Find Courts" }));

    const url = mockPush.mock.calls[0][0] as string;
    expect(url).not.toContain("location=");
  });
});
