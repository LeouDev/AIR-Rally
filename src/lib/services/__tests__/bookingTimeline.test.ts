/**
 * @jest-environment node
 */
import { buildBookingTimeline } from "../bookingTimeline";
import type { OwnerBookingWithDetails } from "../ownerBookings";

const NOW = new Date("2026-08-19T12:00:00Z").getTime();

const BASE: OwnerBookingWithDetails = {
  id: "booking-1",
  courtId: "court-1",
  courtName: "Court 1",
  venueId: "venue-1",
  venueName: "Banilad Pickle Club",
  venueTimezone: "Asia/Manila",
  customerName: "Jane Player",
  customerAvatarUrl: null,
  startTime: "2026-08-20T01:00:00Z",
  endTime: "2026-08-20T02:00:00Z",
  status: "confirmed",
  priceAmount: 1000,
  currency: "PHP",
  paymentProvider: "paymongo",
  paidAt: "2026-08-18T05:00:00Z",
  cancelledAt: null,
  confirmationCode: "ABC123",
  createdAt: "2026-08-18T04:00:00Z",
};

describe("buildBookingTimeline", () => {
  it("orders lifecycle entries oldest-first and flags future ones as upcoming", () => {
    const timeline = buildBookingTimeline(BASE, NOW);
    expect(timeline).toEqual([
      { at: "2026-08-18T04:00:00Z", label: "Booking created", upcoming: false },
      { at: "2026-08-18T05:00:00Z", label: "Payment received", upcoming: false },
      { at: "2026-08-20T01:00:00Z", label: "Session starts", upcoming: true },
      { at: "2026-08-20T02:00:00Z", label: "Session ends", upcoming: true },
    ]);
  });

  it("marks an already-finished session's start and end as not upcoming", () => {
    const past = { ...BASE, startTime: "2026-08-19T01:00:00Z", endTime: "2026-08-19T02:00:00Z" };
    const timeline = buildBookingTimeline(past, NOW);
    expect(timeline.every((entry) => !entry.upcoming)).toBe(true);
  });

  it("omits the session start/end for a cancelled booking — that session never happened", () => {
    const cancelled = { ...BASE, status: "cancelled" as const, cancelledAt: "2026-08-18T06:00:00Z" };
    const timeline = buildBookingTimeline(cancelled, NOW);
    expect(timeline.map((entry) => entry.label)).toEqual(["Booking created", "Payment received", "Booking cancelled"]);
  });

  it("omits the payment entry for a booking that was never paid", () => {
    const unpaid = { ...BASE, paidAt: null };
    expect(buildBookingTimeline(unpaid, NOW).map((e) => e.label)).toEqual(["Booking created", "Session starts", "Session ends"]);
  });
});
