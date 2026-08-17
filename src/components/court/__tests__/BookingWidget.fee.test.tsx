import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
// The player search inside PlayerPicker is irrelevant to the fee breakdown
// and would otherwise fire its own server action on render.
jest.mock("../PlayerPicker", () => ({ PlayerPicker: () => null }));

const mockGetSlots = getAvailableSlotsAction as jest.MockedFunction<typeof getAvailableSlotsAction>;

/** A ₱400 court — the exact price the live PayMongo fee was measured against. */
const COURT = {
  id: "court-1",
  venue_id: "venue-1",
  name: "Court 2 — Riverside",
  hourly_price: 400,
  indoor_outdoor: "outdoor",
  surface: "Cushioned Acrylic",
  is_active: true,
} as unknown as Court;

const SLOT = { slot_start: "2026-09-01T02:00:00Z", slot_end: "2026-09-01T03:00:00Z", is_available: true };

const PROPS = {
  venueName: "AIR/Rally Virtual Court",
  venueTimezone: "Asia/Manila",
  courts: [COURT],
  phone: null,
  email: null,
  isAuthenticated: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSlots.mockResolvedValue({ success: true, data: [SLOT] } as never);
});

/** Opens the confirm dialog on the first available slot. */
async function openConfirmDialog() {
  const slot = await screen.findByRole("button", { name: /10:00 AM/ });
  await userEvent.click(slot);
  return screen.findByRole("dialog");
}

describe("BookingWidget confirm dialog — online payment fee", () => {
  it("shows only a plain total when fees are not passed on", async () => {
    render(<BookingWidget {...PROPS} passOnFees={false} />);
    const dialog = await openConfirmDialog();

    expect(dialog).toHaveTextContent("Total");
    expect(dialog).toHaveTextContent("₱400");
    expect(dialog).not.toHaveTextContent(/Online payment fee/);
    expect(dialog).not.toHaveTextContent(/AIR\/Rally Credits and this fee/);
  });

  it("breaks the charge into court, fee, and total when fees are passed on", async () => {
    render(<BookingWidget {...PROPS} passOnFees />);
    const dialog = await openConfirmDialog();

    // The exact figures PayMongo charged live for a ₱400 court: ₱406.09.
    expect(dialog).toHaveTextContent("Court (1 hr)");
    expect(dialog).toHaveTextContent("₱400");
    expect(dialog).toHaveTextContent("Online payment fee");
    expect(dialog).toHaveTextContent("₱6.09");
    expect(dialog).toHaveTextContent("Total");
    expect(dialog).toHaveTextContent("₱406.09");
  });

  it("never calls the fee a service or booking fee", async () => {
    render(<BookingWidget {...PROPS} passOnFees />);
    const dialog = await openConfirmDialog();

    // Both labels imply AIR/Rally keeps the money. It does not — this is
    // PayMongo's charge, passed through in full.
    expect(dialog).not.toHaveTextContent(/service fee/i);
    expect(dialog).not.toHaveTextContent(/booking fee/i);
  });

  it("tells the customer credits avoid the fee", async () => {
    render(<BookingWidget {...PROPS} passOnFees />);
    const dialog = await openConfirmDialog();

    expect(dialog).toHaveTextContent("Book with AIR/Rally Credits and this fee doesn't apply.");
  });
});
