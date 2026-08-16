/**
 * @jest-environment node
 */
import { getOwnerCourtSchedule, todayInTimezone, computeDisplayAxisMinutes, mergeWithClosedSlots } from "../ownerAvailability";
import { createRpcMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";
import type { VenueOperatingHours } from "@/lib/supabase/types";
import type { OwnerScheduleSlot } from "../ownerAvailability";

function operatingHours(dayOfWeek: number, start: string, end: string): VenueOperatingHours {
  return {
    id: `hours-${dayOfWeek}`,
    venue_id: "venue-1",
    day_of_week: dayOfWeek,
    start_time: start,
    end_time: end,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function bookedSlot(iso: string): OwnerScheduleSlot {
  return {
    slotStart: iso,
    slotEnd: iso,
    status: "booked",
    bookingId: "booking-1",
    bookingStatus: "confirmed",
    customerName: "Jane",
    blockId: null,
    blockReason: null,
  };
}

describe("getOwnerCourtSchedule", () => {
  it("maps the RPC's snake_case rows to camelCase, and passes real params through", async () => {
    const supabase = createRpcMockSupabase({
      data: [
        {
          slot_start: "2026-08-20T01:00:00Z",
          slot_end: "2026-08-20T02:00:00Z",
          status: "booked",
          booking_id: "booking-1",
          booking_status: "confirmed",
          customer_name: "John",
          block_id: null,
          block_reason: null,
        },
        {
          slot_start: "2026-08-20T02:00:00Z",
          slot_end: "2026-08-20T03:00:00Z",
          status: "blocked",
          booking_id: null,
          booking_status: null,
          customer_name: null,
          block_id: "block-1",
          block_reason: "Maintenance",
        },
      ],
      error: null,
    });

    const result = await getOwnerCourtSchedule(supabase, "court-1", "2026-08-20");

    expect(supabase.rpc).toHaveBeenCalledWith("get_owner_court_schedule", {
      p_court_id: "court-1",
      p_local_date: "2026-08-20",
      p_duration_minutes: 60,
      p_increment_minutes: 60,
    });
    expect(result).toEqual([
      {
        slotStart: "2026-08-20T01:00:00Z",
        slotEnd: "2026-08-20T02:00:00Z",
        status: "booked",
        bookingId: "booking-1",
        bookingStatus: "confirmed",
        customerName: "John",
        blockId: null,
        blockReason: null,
      },
      {
        slotStart: "2026-08-20T02:00:00Z",
        slotEnd: "2026-08-20T03:00:00Z",
        status: "blocked",
        bookingId: null,
        bookingStatus: null,
        customerName: null,
        blockId: "block-1",
        blockReason: "Maintenance",
      },
    ]);
  });

  it("returns an empty array for a court the caller doesn't own (the RPC's own ownership check returns zero rows, not an error)", async () => {
    const supabase = createRpcMockSupabase({ data: [], error: null });
    const result = await getOwnerCourtSchedule(supabase, "someone-elses-court", "2026-08-20");
    expect(result).toEqual([]);
  });

  it("propagates a real database error rather than swallowing it", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: postgrestError("42501") });
    await expect(getOwnerCourtSchedule(supabase, "court-1", "2026-08-20")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("todayInTimezone", () => {
  it("formats as YYYY-MM-DD for a given IANA timezone", () => {
    expect(todayInTimezone("Asia/Manila")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeDisplayAxisMinutes", () => {
  it("returns null when the venue has no operating hours configured at all", () => {
    expect(computeDisplayAxisMinutes([])).toBeNull();
  });

  it("takes the union of min-start/max-end across every configured day", () => {
    const hours = [operatingHours(0, "08:00:00", "20:00:00"), operatingHours(1, "06:00:00", "22:00:00")];
    expect(computeDisplayAxisMinutes(hours)).toEqual({ startMinutes: 360, endMinutes: 1320 });
  });
});

describe("mergeWithClosedSlots", () => {
  const weekdayHours = [
    operatingHours(0, "08:00:00", "20:00:00"),
    operatingHours(1, "06:00:00", "22:00:00"),
    operatingHours(2, "06:00:00", "22:00:00"),
    operatingHours(3, "06:00:00", "22:00:00"),
    operatingHours(4, "06:00:00", "22:00:00"),
    operatingHours(5, "06:00:00", "22:00:00"),
    operatingHours(6, "08:00:00", "20:00:00"),
  ];

  it("returns [] when there's no display axis (no operating hours at all)", () => {
    expect(mergeWithClosedSlots([bookedSlot("2026-08-22T08:00:00Z")], [], 6, "UTC")).toEqual([]);
  });

  it("pads a shorter day's real slots out to the venue-wide axis, marking the gap as closed", () => {
    const realSlots: OwnerScheduleSlot[] = [];
    for (let hour = 8; hour < 20; hour++) {
      const iso = `2026-08-22T${String(hour).padStart(2, "0")}:00:00Z`;
      if (hour === 8) {
        realSlots.push({ slotStart: iso, slotEnd: iso, status: "booked", bookingId: "b1", bookingStatus: "confirmed", customerName: "Jane", blockId: null, blockReason: null });
      } else if (hour === 15) {
        realSlots.push({ slotStart: iso, slotEnd: iso, status: "blocked", bookingId: null, bookingStatus: null, customerName: null, blockId: "blk1", blockReason: "Maintenance" });
      } else {
        realSlots.push({ slotStart: iso, slotEnd: iso, status: "available", bookingId: null, bookingStatus: null, customerName: null, blockId: null, blockReason: null });
      }
    }

    // Saturday (day_of_week = 6) only opens 08:00-20:00, but the axis
    // (driven by the weekday rows) spans 06:00-22:00.
    const merged = mergeWithClosedSlots(realSlots, weekdayHours, 6, "UTC");
    const byTime = new Map(merged.map((s) => [s.localTime, s]));

    expect(merged).toHaveLength(16); // (22:00 - 06:00) at 60-minute increments
    expect(byTime.get("06:00")?.status).toBe("closed");
    expect(byTime.get("07:00")?.status).toBe("closed");
    expect(byTime.get("20:00")?.status).toBe("closed");
    expect(byTime.get("21:00")?.status).toBe("closed");
    expect(byTime.get("08:00")).toMatchObject({ status: "booked", bookingId: "b1" });
    expect(byTime.get("15:00")).toMatchObject({ status: "blocked", blockId: "blk1" });
    expect(byTime.get("09:00")?.status).toBe("available");
  });

  it("marks every slot closed for a day with no operating-hours row at all", () => {
    const sundayOnlyMissing = weekdayHours.filter((h) => h.day_of_week !== 0);
    const merged = mergeWithClosedSlots([], sundayOnlyMissing, 0, "UTC");
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.every((s) => s.status === "closed")).toBe(true);
  });
});
