import { nextUpcomingBooking } from "@/lib/upcomingBookings";
import type { BookingWithDetails } from "@/lib/services/bookings";

const NOW = Date.parse("2026-08-19T00:00:00.000Z");

function booking(overrides: Partial<BookingWithDetails> & { id: string }): BookingWithDetails {
  return {
    status: "confirmed",
    start_time: "2026-08-20T10:00:00.000Z",
    end_time: "2026-08-20T11:00:00.000Z",
    venueName: "AIR/Rally Virtual Court",
    courtName: "Court 2 — Riverside",
    venueCity: "Mandaue",
    venueTimezone: "Asia/Manila",
    confirmation_code: "76E2227B",
    ...overrides,
  } as BookingWithDetails;
}

describe("nextUpcomingBooking", () => {
  it("returns null when there is nothing booked", () => {
    expect(nextUpcomingBooking([], NOW)).toBeNull();
  });

  it("picks the soonest future booking, not the first in the list", () => {
    const later = booking({ id: "later", start_time: "2026-08-25T10:00:00.000Z" });
    const sooner = booking({ id: "sooner", start_time: "2026-08-20T10:00:00.000Z" });
    expect(nextUpcomingBooking([later, sooner], NOW)?.id).toBe("sooner");
  });

  it("ignores bookings that have already started", () => {
    const past = booking({ id: "past", start_time: "2026-08-18T10:00:00.000Z" });
    const future = booking({ id: "future", start_time: "2026-08-21T10:00:00.000Z" });
    expect(nextUpcomingBooking([past, future], NOW)?.id).toBe("future");
  });

  it("ignores cancelled bookings", () => {
    const cancelled = booking({ id: "cancelled", status: "cancelled", start_time: "2026-08-19T10:00:00.000Z" });
    const confirmed = booking({ id: "confirmed", start_time: "2026-08-22T10:00:00.000Z" });
    expect(nextUpcomingBooking([cancelled, confirmed], NOW)?.id).toBe("confirmed");
  });

  it("still surfaces a pending booking — a settling payment is exactly what someone opens the app to check", () => {
    const pending = booking({ id: "pending", status: "pending", start_time: "2026-08-20T10:00:00.000Z" });
    expect(nextUpcomingBooking([pending], NOW)?.id).toBe("pending");
  });
});
