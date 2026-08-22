import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, VenueOperatingHours } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type OwnerScheduleSlot = {
  slotStart: string;
  slotEnd: string;
  status: "booked" | "blocked" | "available";
  bookingId: string | null;
  bookingStatus: string | null;
  customerName: string | null;
  blockId: string | null;
  blockReason: string | null;
};

/**
 * The owner-facing day schedule for one court — every candidate slot for
 * the day, labeled. See get_owner_court_schedule() (supabase/migrations/
 * 20260810000017_owner_court_schedule.sql) for why this is a dedicated
 * RPC rather than reusing getAvailableSlots(): that function only ever
 * returns the bookable subset, which is right for a customer's picker
 * but wrong for a calendar that needs to show and explain every slot.
 * Returns an empty array (not an error) for a court the caller doesn't
 * own — the RPC's own ownership check, not a client-side one.
 */
export async function getOwnerCourtSchedule(
  supabase: Client,
  courtId: string,
  localDate: string,
  durationMinutes = 60,
  incrementMinutes = 60
): Promise<OwnerScheduleSlot[]> {
  const { data, error } = await supabase.rpc("get_owner_court_schedule", {
    p_court_id: courtId,
    p_local_date: localDate,
    p_duration_minutes: durationMinutes,
    p_increment_minutes: incrementMinutes,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    status: row.status,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    customerName: row.customer_name,
    blockId: row.block_id,
    blockReason: row.block_reason,
  }));
}

/** "Today" in a given IANA timezone, not the server's — a venue in
 * Manila and a server running in another region must agree on what day
 * it currently is there. Shared by the availability page and the
 * dashboard summary, both of which need "today" per-venue. */
export function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Calendar-day arithmetic on a date-only "YYYY-MM-DD" value. Routed
 * through UTC deliberately: the input carries no time and no zone, so
 * building it this way cannot pick up the host's own offset — which is
 * exactly what `new Date("2026-09-01T00:00:00")` does, since that parses
 * as *local* midnight. In a UTC+8 browser that lands on
 * 2026-08-31T16:00Z, so reading the day back off `.toISOString()` gives
 * the previous date and the shift silently loses a day. */
export function shiftLocalDate(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// --- 4-state calendar: padding real RPC slots with "closed" gaps -------
//
// venue_operating_hours is one row per (venue_id, day_of_week) — a
// single contiguous window, no split-hours model — so "closed" detection
// is simple: a day with no row for that day_of_week is closed all day; a
// day with a row is closed outside [start_time, end_time). This whole
// section is pure (no Supabase calls), so it's testable with plain
// fixtures — no mocked client needed.

export type MergedSlot = {
  /** "HH:MM", 24-hour, in the venue's own local time. */
  localTime: string;
  status: "available" | "booked" | "blocked" | "closed";
  bookingId: string | null;
  bookingStatus: string | null;
  customerName: string | null;
  blockId: string | null;
  blockReason: string | null;
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToLocalTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function localTimeMinutesFromIso(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * The fixed time axis to display every day of the week against: the
 * union of every configured operating window's start/end, across all 7
 * days. A venue open 6am-11pm on weekdays and 8am-9pm on weekends always
 * shows the same 6am-11pm axis, with the weekend's extra closed hours
 * rendered as "Closed" rather than the day simply having fewer rows.
 * Null when the venue has no operating hours configured at all (nothing
 * to show an axis for).
 */
export function computeDisplayAxisMinutes(operatingHours: VenueOperatingHours[]): { startMinutes: number; endMinutes: number } | null {
  if (operatingHours.length === 0) return null;
  const starts = operatingHours.map((h) => toMinutes(h.start_time));
  const ends = operatingHours.map((h) => toMinutes(h.end_time));
  return { startMinutes: Math.min(...starts), endMinutes: Math.max(...ends) };
}

/**
 * Pads a court's real RPC slots (available/booked/blocked, only ever
 * generated within that day's own operating window) out to the venue's
 * full display axis, marking anything outside that specific day's window
 * as "closed". Never mutates or drops a real slot — only adds synthetic
 * closed rows around them.
 */
export function mergeWithClosedSlots(
  slots: OwnerScheduleSlot[],
  operatingHours: VenueOperatingHours[],
  dayOfWeek: number,
  timezone: string,
  incrementMinutes = 60
): MergedSlot[] {
  const axis = computeDisplayAxisMinutes(operatingHours);
  if (!axis) return [];

  const dayWindow = operatingHours.find((h) => h.day_of_week === dayOfWeek);
  const dayStartMinutes = dayWindow ? toMinutes(dayWindow.start_time) : null;
  const dayEndMinutes = dayWindow ? toMinutes(dayWindow.end_time) : null;

  const slotByLocalTime = new Map<string, OwnerScheduleSlot>();
  for (const slot of slots) {
    slotByLocalTime.set(minutesToLocalTime(localTimeMinutesFromIso(slot.slotStart, timezone)), slot);
  }

  const merged: MergedSlot[] = [];
  for (let minutes = axis.startMinutes; minutes < axis.endMinutes; minutes += incrementMinutes) {
    const localTime = minutesToLocalTime(minutes);
    const real = slotByLocalTime.get(localTime);
    if (real) {
      merged.push({
        localTime,
        status: real.status,
        bookingId: real.bookingId,
        bookingStatus: real.bookingStatus,
        customerName: real.customerName,
        blockId: real.blockId,
        blockReason: real.blockReason,
      });
      continue;
    }
    const isWithinDayWindow = dayStartMinutes !== null && dayEndMinutes !== null && minutes >= dayStartMinutes && minutes < dayEndMinutes;
    merged.push({
      localTime,
      // Within the day's own window but missing from the real slots
      // shouldn't happen at matching increments (the RPC generates every
      // candidate in that range) — falls back to "available" rather than
      // a potentially-false "closed" if it ever does.
      status: isWithinDayWindow ? "available" : "closed",
      bookingId: null,
      bookingStatus: null,
      customerName: null,
      blockId: null,
      blockReason: null,
    });
  }
  return merged;
}
