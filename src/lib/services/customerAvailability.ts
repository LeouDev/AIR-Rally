import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AvailableSlot, VenueOperatingHours } from "@/lib/supabase/types";
import { getAvailableSlots } from "@/lib/services/availability";
import { listOperatingHours } from "@/lib/services/venues";
import { todayInTimezone, computeDisplayAxisMinutes } from "@/lib/services/ownerAvailability";
import { SLOT_INCREMENT_MINUTES, MIN_DURATION_MINUTES } from "@/lib/booking-config";

type Client = SupabaseClient<Database>;

/**
 * Customer-safe availability helpers — the marketplace-browsing
 * counterpart to ownerAvailability.ts, deliberately kept in its own
 * file. Only two owner-module exports are imported here:
 * todayInTimezone() and computeDisplayAxisMinutes(), because neither
 * carries any owner-specific data — the first is pure timezone math on
 * a string, the second is pure min/max math over venue_operating_hours
 * rows. Never import getOwnerCourtSchedule() or mergeWithClosedSlots()
 * from here: their RPC/output carries customerName/bookingId/
 * blockReason, and the RPC itself is granted to `authenticated` only,
 * not `anon`. The actual bookable/not-bookable determination always
 * comes from getAvailableSlots() (existing, anon-callable, structurally
 * incapable of leaking who booked what since it only ever selects
 * slot_start/slot_end) — this file only decides how to label the gaps
 * around that real data, never recomputes availability itself.
 */

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function localDayOfWeek(instant: Date, timezone: string): number {
  const abbr = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(instant);
  return WEEKDAY_ABBR.indexOf(abbr);
}

function localMinutesOfDay(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function formatHourLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return min === 0 ? `${hour12}${period}` : `${hour12}:${String(min).padStart(2, "0")}${period}`;
}

export type OpenStatus = {
  isOpenNow: boolean;
  label: string;
};

/**
 * "Open now · closes 9pm" / "Closed · opens 6am" / "Closed today" —
 * computed purely from operating hours, no booking lookups at all. This
 * is what keeps a results grid of a few dozen cards fast: real
 * slot-level availability (getCourtAvailabilityToday, below) only ever
 * runs one venue at a time, on the Venue Detail page.
 */
export function computeOpenStatus(operatingHours: VenueOperatingHours[], timezone: string, now: Date = new Date()): OpenStatus {
  const dayOfWeek = localDayOfWeek(now, timezone);
  const nowMinutes = localMinutesOfDay(now, timezone);
  const today = operatingHours.find((h) => h.day_of_week === dayOfWeek);

  if (!today) {
    return { isOpenNow: false, label: "Closed today" };
  }

  const startMinutes = toMinutes(today.start_time);
  const endMinutes = toMinutes(today.end_time);

  if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
    return { isOpenNow: true, label: `Open now · closes ${formatHourLabel(endMinutes)}` };
  }
  if (nowMinutes < startMinutes) {
    return { isOpenNow: false, label: `Closed · opens ${formatHourLabel(startMinutes)}` };
  }
  return { isOpenNow: false, label: "Closed today" };
}

export type CustomerAvailabilitySlot = {
  /** "HH:MM", 24-hour, in the venue's own local time. */
  localTime: string;
  status: "available" | "unavailable" | "closed";
};

/**
 * Pads getAvailableSlots()'s output out to the day's full operating
 * window, labeling every gap "unavailable" — never booked vs. blocked,
 * because that distinction needs owner-only data (see file header) that
 * never reaches this function. Mirrors mergeWithClosedSlots()'s padding
 * logic (ownerAvailability.ts) but with one generic "unavailable"
 * bucket instead of two owner-only ones.
 */
export function mergeCustomerAvailability(
  availableSlots: AvailableSlot[],
  operatingHours: VenueOperatingHours[],
  dayOfWeek: number,
  timezone: string,
  incrementMinutes: number = SLOT_INCREMENT_MINUTES
): CustomerAvailabilitySlot[] {
  const axis = computeDisplayAxisMinutes(operatingHours);
  if (!axis) return [];

  const dayWindow = operatingHours.find((h) => h.day_of_week === dayOfWeek);
  const dayStartMinutes = dayWindow ? toMinutes(dayWindow.start_time) : null;
  const dayEndMinutes = dayWindow ? toMinutes(dayWindow.end_time) : null;

  const availableTimes = new Set(availableSlots.map((slot) => minutesToLocalTime(localTimeMinutesFromIso(slot.slot_start, timezone))));

  const merged: CustomerAvailabilitySlot[] = [];
  for (let minutes = axis.startMinutes; minutes < axis.endMinutes; minutes += incrementMinutes) {
    const localTime = minutesToLocalTime(minutes);
    const isWithinDayWindow = dayStartMinutes !== null && dayEndMinutes !== null && minutes >= dayStartMinutes && minutes < dayEndMinutes;
    if (!isWithinDayWindow) {
      merged.push({ localTime, status: "closed" });
      continue;
    }
    merged.push({ localTime, status: availableTimes.has(localTime) ? "available" : "unavailable" });
  }
  return merged;
}

/**
 * Today's availability for one court, customer-safe. Requests the
 * shortest bookable duration (MIN_DURATION_MINUTES) from
 * getAvailableSlots() so the preview shows a slot as available whenever
 * *any* bookable duration fits — a customer browsing hasn't committed
 * to a duration yet, unlike the actual booking flow in BookingWidget.
 */
export async function getCourtAvailabilityToday(
  supabase: Client,
  courtId: string,
  venueId: string,
  timezone: string
): Promise<CustomerAvailabilitySlot[]> {
  const localDate = todayInTimezone(timezone);
  const dayOfWeek = new Date(`${localDate}T00:00:00Z`).getUTCDay();

  const [availableSlots, operatingHours] = await Promise.all([
    getAvailableSlots(supabase, courtId, localDate, MIN_DURATION_MINUTES),
    listOperatingHours(supabase, venueId),
  ]);

  return mergeCustomerAvailability(availableSlots, operatingHours, dayOfWeek, timezone, SLOT_INCREMENT_MINUTES);
}
