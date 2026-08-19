import { render, screen, waitFor } from "@testing-library/react";
import { BookingWidget } from "../BookingWidget";
import { getAvailableSlotsAction } from "../../../lib/actions/availability";
import type { Court } from "../../../lib/supabase/types";

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../lib/actions/availability", () => ({ getAvailableSlotsAction: jest.fn() }));
jest.mock("../../../lib/actions/checkout", () => ({ createCheckoutSessionAction: jest.fn() }));
jest.mock("../../../lib/actions/events", () => ({ createOpenPlayForBookingAction: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/courts/venue-1",
}));
jest.mock("../PlayerPicker", () => ({ PlayerPicker: () => null }));

const mockGetSlots = getAvailableSlotsAction as jest.MockedFunction<typeof getAvailableSlotsAction>;

const COURT = {
  id: "court-1",
  venue_id: "venue-1",
  name: "Court A",
  hourly_price: 400,
  indoor_outdoor: "outdoor",
  surface: "Concrete",
  is_active: true,
} as unknown as Court;

const PROPS = {
  venueName: "AIR/Rally Club",
  venueTimezone: "Asia/Manila",
  courts: [COURT],
  phone: null,
  email: null,
  isAuthenticated: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  // No available slots for the selected date, regardless of the reason —
  // both cases below start from the same empty getAvailableSlotsAction
  // result; hasOperatingHours is what should change the message shown.
  mockGetSlots.mockResolvedValue({ success: true, data: [] } as never);
});

describe("BookingWidget — empty availability messaging", () => {
  it("blames the date when the venue does have operating hours configured", async () => {
    render(<BookingWidget {...PROPS} hasOperatingHours />);

    await waitFor(() => {
      expect(screen.getByText("No available times for this date and duration. Try another date.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/hasn't set its operating hours/)).not.toBeInTheDocument();
  });

  it("defaults to the date-blaming message when hasOperatingHours is omitted, unchanged for every existing caller", async () => {
    render(<BookingWidget {...PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("No available times for this date and duration. Try another date.")).toBeInTheDocument();
    });
  });

  it("tells the truth instead of blaming the date when the venue has zero operating-hours rows", async () => {
    render(<BookingWidget {...PROPS} hasOperatingHours={false} />);

    await waitFor(() => {
      expect(screen.getByText(/hasn't set its operating hours yet, so it can't be booked on any date/)).toBeInTheDocument();
    });
    expect(screen.queryByText("No available times for this date and duration. Try another date.")).not.toBeInTheDocument();
  });
});
