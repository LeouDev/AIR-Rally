import type { OwnerBookingWithDetails } from "@/lib/services/ownerBookings";

export type BookingTimelineEntry = {
  /** ISO timestamp the entry happened at — entries are returned oldest-first. */
  at: string;
  label: string;
  /** True for entries that haven't happened yet (a future session start/end). */
  upcoming: boolean;
};

/**
 * Chronological lifecycle of a single booking, assembled purely from
 * timestamps the booking row already carries — no extra queries, no new
 * table. Deliberately scoped to the booking's own lifecycle: refund,
 * reschedule, and review events live in sibling tables that neither of
 * this dialog's two call sites fetch today, so folding them in would mean
 * widening both queries. Not included here rather than faked.
 */
export function buildBookingTimeline(booking: OwnerBookingWithDetails, now: number = Date.now()): BookingTimelineEntry[] {
  const entries: BookingTimelineEntry[] = [{ at: booking.createdAt, label: "Booking created", upcoming: false }];

  if (booking.paidAt) {
    entries.push({ at: booking.paidAt, label: "Payment received", upcoming: false });
  }
  if (booking.cancelledAt) {
    entries.push({ at: booking.cancelledAt, label: "Booking cancelled", upcoming: false });
  }

  // A cancelled booking's session never happens, so its start/end are not
  // part of its real history.
  if (booking.status !== "cancelled") {
    const startMs = new Date(booking.startTime).getTime();
    const endMs = new Date(booking.endTime).getTime();
    entries.push({ at: booking.startTime, label: "Session starts", upcoming: startMs > now });
    entries.push({ at: booking.endTime, label: "Session ends", upcoming: endMs > now });
  }

  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
