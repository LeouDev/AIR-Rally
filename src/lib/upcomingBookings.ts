import type { BookingWithDetails } from "@/lib/services/bookings";

/**
 * The soonest booking that has not started yet, and has not been cancelled.
 *
 * `pending` counts. A payment still settling is exactly the booking someone
 * opens the app to check on, and hiding it is what makes a stuck payment feel
 * like a booking that never happened.
 *
 * Lives in lib rather than beside the component that renders it: importing it
 * from a component module would pull the whole Home render tree — and with it
 * `next/cache` — into any test that only wanted to check the ordering.
 */
export function nextUpcomingBooking(
  bookings: BookingWithDetails[],
  now: number = Date.now()
): BookingWithDetails | null {
  const upcoming = bookings
    .filter((b) => b.status !== "cancelled" && new Date(b.start_time).getTime() > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return upcoming[0] ?? null;
}
