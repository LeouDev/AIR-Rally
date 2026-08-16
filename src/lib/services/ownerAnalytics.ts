import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { listOwnerCourtsWithVenue } from "@/lib/services/ownerBookings";

type Client = SupabaseClient<Database>;

const DEFAULT_CURRENCY = "PHP";

export type RevenuePeriod = {
  amount: number;
  previousAmount: number;
  /** null when the previous period had zero revenue — a percentage change is undefined, not 0 or infinite. */
  changePct: number | null;
};

export type CourtOccupancy = {
  courtId: string;
  courtName: string;
  bookedHours: number;
  openHours: number;
  /** null when openHours is 0 (no operating hours configured for this venue yet). */
  occupancyPct: number | null;
};

export type MostBookedCourt = {
  courtId: string;
  courtName: string;
  bookingCount: number;
};

export type OwnerAnalytics = {
  currency: string;
  revenue: {
    today: RevenuePeriod;
    thisWeek: RevenuePeriod;
    thisMonth: RevenuePeriod;
  };
  occupancy: {
    /** Booked-hours ÷ open-hours per court, scoped to the current calendar month to date. */
    perCourt: CourtOccupancy[];
    mostBookedCourts: MostBookedCourt[];
    /** Hour of day (0–23, in each booking's own venue timezone) with the most bookings this month. Null if no bookings yet. */
    peakHour: number | null;
    /** Hour of day with the fewest bookings, among hours that had at least one. Null if no bookings yet. */
    lowestHour: number | null;
  };
  bookingInsights: {
    /** All bookings created this calendar month, any status. */
    totalBookings: number;
    /** Distinct customers with more than one booking this calendar month. */
    repeatCustomers: number;
    /** cancelled ÷ total, this calendar month. 0 when there are no bookings. */
    cancellationRate: number;
  };
};

type BookingRow = {
  court_id: string;
  user_id: string;
  price_amount: number;
  currency: string;
  status: string;
  start_time: string;
  end_time: string;
};

type OperatingHoursRow = { venue_id: string; day_of_week: number; start_time: string; end_time: string };

function utcDayBounds(daysAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function utcWeekBounds(weeksAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay() - weeksAgo * 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

function utcMonthBounds(monthsAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
  return { start, end };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

function sumConfirmedRevenue(bookings: BookingRow[], start: Date, end: Date): number {
  return bookings
    .filter((b) => b.status === "confirmed" && inRange(b.start_time, start, end))
    .reduce((sum, b) => sum + b.price_amount, 0);
}

function revenuePeriod(bookings: BookingRow[], current: { start: Date; end: Date }, previous: { start: Date; end: Date }): RevenuePeriod {
  const amount = sumConfirmedRevenue(bookings, current.start, current.end);
  const previousAmount = sumConfirmedRevenue(bookings, previous.start, previous.end);
  const changePct = previousAmount === 0 ? null : (amount - previousAmount) / previousAmount;
  return { amount, previousAmount, changePct };
}

/** "HH:MM:SS" wall-clock string → minutes since midnight. */
function hmsToMinutes(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h * 60 + m;
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
}

/**
 * Total open hours for one venue between `from` (inclusive) and `to`
 * (exclusive, both UTC), derived by walking each calendar day in the
 * range and summing whichever `venue_operating_hours` rows match that
 * day's day-of-week. A cheap, documented approximation — like the
 * operating-hours approach used for availability search — not a
 * timezone-exact wall-clock calculation, since bookings are what's being
 * measured against, not a live slot check.
 */
function openHoursInRange(operatingHours: OperatingHoursRow[], venueId: string, from: Date, to: Date): number {
  const rowsForVenue = operatingHours.filter((r) => r.venue_id === venueId);
  if (rowsForVenue.length === 0) return 0;

  let total = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor.getTime() < to.getTime()) {
    const dow = cursor.getUTCDay();
    for (const row of rowsForVenue) {
      if (row.day_of_week === dow) {
        total += (hmsToMinutes(row.end_time) - hmsToMinutes(row.start_time)) / 60;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

/** Hour of day (0–23) a booking starts in, in its own venue's local timezone. */
function localStartHour(startIso: string, timezone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date(startIso));
  // Intl can format midnight as "24" depending on locale/runtime — normalize to 0.
  return Number(formatted) % 24;
}

/**
 * Phase 7.2 owner analytics: revenue (today/this-week/this-month, each
 * with a same-length prior-period comparison), occupancy (booked ÷ open
 * hours per court, most-booked courts, peak/lowest booking hour), and
 * booking insights (total, repeat customers, cancellation rate) — all
 * for the courts this owner owns.
 *
 * One windowed booking fetch (back to the start of last month, forward
 * to now) covers every period below; everything is aggregated in JS from
 * that single dataset, extending the same approach
 * `getOwnerDashboardSummary` already uses for its "this week" figures,
 * rather than issuing one query per metric.
 *
 * Reads only provider-agnostic columns (price_amount/currency/status) —
 * same boundary `getVenueEarnings` already respects — never
 * platform_fee_amount, venue_amount, or any paymongo- or stripe-prefixed column.
 */
export async function getOwnerAnalytics(supabase: Client, ownerId: string): Promise<OwnerAnalytics> {
  const empty: OwnerAnalytics = {
    currency: DEFAULT_CURRENCY,
    revenue: {
      today: { amount: 0, previousAmount: 0, changePct: null },
      thisWeek: { amount: 0, previousAmount: 0, changePct: null },
      thisMonth: { amount: 0, previousAmount: 0, changePct: null },
    },
    occupancy: { perCourt: [], mostBookedCourts: [], peakHour: null, lowestHour: null },
    bookingInsights: { totalBookings: 0, repeatCustomers: 0, cancellationRate: 0 },
  };

  const { courts, venuesById } = await listOwnerCourtsWithVenue(supabase, ownerId);
  if (courts.length === 0) return empty;
  const courtNameById = new Map(courts.map((c) => [c.id, c.name]));
  const courtIds = courts.map((c) => c.id);

  const thisMonth = utcMonthBounds(0);
  const lastMonth = utcMonthBounds(1);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("court_id, user_id, price_amount, currency, status, start_time, end_time")
    .in("court_id", courtIds)
    .gte("start_time", lastMonth.start.toISOString())
    .lt("start_time", thisMonth.end.toISOString());
  if (bookingsError) throw bookingsError;
  const bookingRows = (bookings ?? []) as BookingRow[];

  const currency = bookingRows.find((b) => b.status === "confirmed")?.currency ?? DEFAULT_CURRENCY;

  const revenue = {
    today: revenuePeriod(bookingRows, utcDayBounds(0), utcDayBounds(1)),
    thisWeek: revenuePeriod(bookingRows, utcWeekBounds(0), utcWeekBounds(1)),
    thisMonth: revenuePeriod(bookingRows, thisMonth, lastMonth),
  };

  const monthBookings = bookingRows.filter((b) => inRange(b.start_time, thisMonth.start, thisMonth.end));
  const activeMonthBookings = monthBookings.filter((b) => b.status !== "cancelled");

  const { data: operatingHours, error: ohError } = await supabase
    .from("venue_operating_hours")
    .select("venue_id, day_of_week, start_time, end_time")
    .in("venue_id", Array.from(venuesById.keys()));
  if (ohError) throw ohError;
  const operatingHoursRows = (operatingHours ?? []) as OperatingHoursRow[];

  const now = new Date();
  const bookedHoursByCourtId = new Map<string, number>();
  const bookingCountByCourtId = new Map<string, number>();
  for (const b of activeMonthBookings) {
    bookedHoursByCourtId.set(b.court_id, (bookedHoursByCourtId.get(b.court_id) ?? 0) + hoursBetween(b.start_time, b.end_time));
    bookingCountByCourtId.set(b.court_id, (bookingCountByCourtId.get(b.court_id) ?? 0) + 1);
  }

  const perCourt: CourtOccupancy[] = courts.map((court) => {
    const venue = venuesById.get(court.venue_id);
    const openHours = venue ? openHoursInRange(operatingHoursRows, venue.id, thisMonth.start, now) : 0;
    const bookedHours = bookedHoursByCourtId.get(court.id) ?? 0;
    return {
      courtId: court.id,
      courtName: court.name,
      bookedHours,
      openHours,
      occupancyPct: openHours === 0 ? null : bookedHours / openHours,
    };
  });

  const mostBookedCourts: MostBookedCourt[] = Array.from(bookingCountByCourtId.entries())
    .map(([courtId, bookingCount]) => ({ courtId, courtName: courtNameById.get(courtId) ?? "Court", bookingCount }))
    .sort((a, b) => b.bookingCount - a.bookingCount)
    .slice(0, 5);

  const hourCounts = new Map<number, number>();
  for (const b of activeMonthBookings) {
    const venue = venuesById.get(courts.find((c) => c.id === b.court_id)?.venue_id ?? "");
    const hour = localStartHour(b.start_time, venue?.timezone ?? "Asia/Manila");
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  let peakHour: number | null = null;
  let lowestHour: number | null = null;
  let maxCount = -Infinity;
  let minCount = Infinity;
  for (const [hour, count] of hourCounts) {
    if (count > maxCount) {
      maxCount = count;
      peakHour = hour;
    }
    if (count < minCount) {
      minCount = count;
      lowestHour = hour;
    }
  }

  const totalBookings = monthBookings.length;
  const cancelledCount = monthBookings.filter((b) => b.status === "cancelled").length;
  const countByCustomer = new Map<string, number>();
  for (const b of monthBookings) {
    countByCustomer.set(b.user_id, (countByCustomer.get(b.user_id) ?? 0) + 1);
  }
  const repeatCustomers = Array.from(countByCustomer.values()).filter((count) => count > 1).length;

  return {
    currency,
    revenue,
    occupancy: { perCourt, mostBookedCourts, peakHour, lowestHour },
    bookingInsights: {
      totalBookings,
      repeatCustomers,
      cancellationRate: totalBookings === 0 ? 0 : cancelledCount / totalBookings,
    },
  };
}
