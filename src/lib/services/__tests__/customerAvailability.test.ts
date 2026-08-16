/**
 * @jest-environment node
 */
import { computeOpenStatus, mergeCustomerAvailability } from "../customerAvailability";
import type { VenueOperatingHours, AvailableSlot } from "@/lib/supabase/types";

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

function availableSlot(iso: string): AvailableSlot {
  return { slot_start: iso, slot_end: iso };
}

describe("computeOpenStatus", () => {
  it("reports open now with a closing time, when within today's window", () => {
    const now = new Date("2026-08-16T10:30:00Z");
    const hours = [operatingHours(now.getUTCDay(), "06:00", "22:00")];
    expect(computeOpenStatus(hours, "UTC", now)).toEqual({ isOpenNow: true, label: "Open now · closes 10pm" });
  });

  it("reports closed with an opening time, when before today's window", () => {
    const now = new Date("2026-08-16T03:00:00Z");
    const hours = [operatingHours(now.getUTCDay(), "06:00", "22:00")];
    expect(computeOpenStatus(hours, "UTC", now)).toEqual({ isOpenNow: false, label: "Closed · opens 6am" });
  });

  it("reports closed today, when after today's window", () => {
    const now = new Date("2026-08-16T23:00:00Z");
    const hours = [operatingHours(now.getUTCDay(), "06:00", "22:00")];
    expect(computeOpenStatus(hours, "UTC", now)).toEqual({ isOpenNow: false, label: "Closed today" });
  });

  it("reports closed today, when no operating-hours row exists for today", () => {
    const now = new Date("2026-08-16T10:00:00Z");
    const otherDay = (now.getUTCDay() + 1) % 7;
    const hours = [operatingHours(otherDay, "06:00", "22:00")];
    expect(computeOpenStatus(hours, "UTC", now)).toEqual({ isOpenNow: false, label: "Closed today" });
  });

  it("formats a half-hour closing/opening time", () => {
    const now = new Date("2026-08-16T10:00:00Z");
    const hours = [operatingHours(now.getUTCDay(), "06:30", "21:30")];
    expect(computeOpenStatus(hours, "UTC", now)).toEqual({ isOpenNow: true, label: "Open now · closes 9:30pm" });
  });
});

describe("mergeCustomerAvailability", () => {
  const weekdayHours = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    d === 0 || d === 6 ? operatingHours(d, "08:00", "20:00") : operatingHours(d, "06:00", "22:00")
  );

  it("returns [] when there's no display axis (no operating hours at all)", () => {
    expect(mergeCustomerAvailability([], [], 6, "UTC", 60)).toEqual([]);
  });

  it("marks real available slots as available, gaps within hours as unavailable, and outside hours as closed", () => {
    const available = [availableSlot("2026-08-22T09:00:00Z"), availableSlot("2026-08-22T11:00:00Z")];
    const merged = mergeCustomerAvailability(available, weekdayHours, 6, "UTC", 60);
    const byTime = new Map(merged.map((s) => [s.localTime, s]));

    expect(byTime.get("06:00")?.status).toBe("closed"); // before Saturday's 08:00 open
    expect(byTime.get("09:00")?.status).toBe("available");
    expect(byTime.get("10:00")?.status).toBe("unavailable"); // within hours, just not in the available list
    expect(byTime.get("11:00")?.status).toBe("available");
    expect(byTime.get("20:00")?.status).toBe("closed"); // Saturday closes at 20:00
  });

  it("never distinguishes booked vs. blocked — everything not available is just 'unavailable'", () => {
    const merged = mergeCustomerAvailability([], weekdayHours, 1, "UTC", 60);
    const statuses = new Set(merged.filter((s) => s.status !== "closed").map((s) => s.status));
    expect(statuses).toEqual(new Set(["unavailable"]));
  });
});
