import { render, screen } from "@testing-library/react";
import { UpcomingBookingCard } from "@/components/home/UpcomingBookingCard";
import type { BookingWithDetails } from "@/lib/services/bookings";

/**
 * 10:00Z is 6:00 PM in Manila. The assertions below would read 6:00 AM (and
 * the link would point at a dead end) if either the venue timezone or the
 * pending-payment route regressed.
 */
function booking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: "booking-1",
    status: "confirmed",
    start_time: "2026-08-19T10:00:00.000Z",
    end_time: "2026-08-19T11:00:00.000Z",
    venueName: "AIR/Rally Virtual Court",
    courtName: "Court 2 — Riverside",
    venueCity: "Mandaue",
    venueTimezone: "Asia/Manila",
    confirmation_code: "76E2227B",
    ...overrides,
  } as BookingWithDetails;
}

describe("UpcomingBookingCard", () => {
  it("shows the venue, court, code, and the slot in the venue's timezone", () => {
    render(<UpcomingBookingCard booking={booking()} />);

    expect(screen.getByText("AIR/Rally Virtual Court")).toBeInTheDocument();
    expect(screen.getByText("Court 2 — Riverside")).toBeInTheDocument();
    expect(screen.getByText("76E2227B")).toBeInTheDocument();
    expect(screen.getByText("Wed, Aug 19 · 6:00 PM – 7:00 PM")).toBeInTheDocument();
  });

  it("renders the venue's timezone even when the venue is not in Manila", () => {
    render(<UpcomingBookingCard booking={booking({ venueTimezone: "America/New_York" })} />);
    expect(screen.getByText("Wed, Aug 19 · 6:00 AM – 7:00 AM")).toBeInTheDocument();
  });

  it("labels the zone it actually rendered, rather than assuming the launch market", () => {
    const { unmount } = render(<UpcomingBookingCard booking={booking()} />);
    expect(screen.getByText("Venue time (GMT+8)")).toBeInTheDocument();
    unmount();

    render(<UpcomingBookingCard booking={booking({ venueTimezone: "America/New_York" })} />);
    expect(screen.getByText("Venue time (EDT)")).toBeInTheDocument();
    expect(screen.queryByText(/PHT/)).not.toBeInTheDocument();
  });

  it("links a confirmed booking to My Bookings", () => {
    render(<UpcomingBookingCard booking={booking()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/bookings");
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("routes a pending booking to the confirmation page, which re-checks the payment", () => {
    render(<UpcomingBookingCard booking={booking({ status: "pending" })} />);

    // The recovery path for a payment whose webhook never arrived — a pending
    // booking must never be a dead end.
    expect(screen.getByRole("link")).toHaveAttribute("href", "/bookings/booking-1/confirmation");
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.getByText("Check status")).toBeInTheDocument();
  });
});
