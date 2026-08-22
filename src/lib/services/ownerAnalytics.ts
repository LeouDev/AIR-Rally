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

/* -------------------------------------------------------------------------
 * Business periods.
 *
 * "Today" is a VENUE-LOCAL calendar day, never a UTC one. Every other
 * date surface in the product already works that way — availability
 * search takes a venue-local date, and localStartHour below already
 * derived the peak booking hour in the venue's own zone. Revenue was the
 * odd one out: it sliced on UTC midnight, so for a Manila venue (UTC+8)
 * an owner's "Today" actually ran 8 AM to 8 AM and every morning booking
 * landed in yesterday's total, dragging the comparison arrows with it.
 * At a month boundary the same skew moved revenue between months.
 *
 * Periods are handled as date-only "YYYY-MM-DD" strings rather than
 * instants: a calendar day has no single UTC extent once venues can sit
 * in different zones, and zero-padded ISO dates compare correctly with
 * plain string operators. Ranges are INCLUSIVE at both ends.
 *
 * The period shapes are unchanged from the UTC version — a full calendar
 * day/week/month containing now, each compared against the immediately
 * preceding full period, weeks starting Sunday to match day_of_week.
 * ---------------------------------------------------------------------- */

export type LocalDateRange = { from: string; to: string };

/** "YYYY-MM-DD" for an instant as seen in `timeZone`. */
export function localDateIn(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar arithmetic on a date-only value. Safe to run through UTC:
 * the input carries no time and no zone, so adding days can never cross
 * a DST transition the way shifting a real instant can. */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return toYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

/** 0 = Sunday, matching day_of_week in venue_operating_hours. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dayRange(today: string, daysAgo: number): LocalDateRange {
  const day = shiftDate(today, -daysAgo);
  return { from: day, to: day };
}

export function weekRange(today: string, weeksAgo: number): LocalDateRange {
  const from = shiftDate(today, -weekdayOf(today) - weeksAgo * 7);
  return { from, to: shiftDate(from, 6) };
}

export function monthRange(today: string, monthsAgo: number): LocalDateRange {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  // Day 0 of the following month is the last day of this one.
  const last = new Date(Date.UTC(y, m - monthsAgo, 0));
  return { from: toYmd(first), to: toYmd(last) };
}

export function isWithin(ymd: string, range: LocalDateRange): boolean {
  return ymd >= range.from && ymd <= range.to;
}

type VenuePeriods = {
  today: LocalDateRange;
  previousDay: LocalDateRange;
  thisWeek: LocalDateRange;
  previousWeek: LocalDateRange;
  thisMonth: LocalDateRange;
  previousMonth: LocalDateRange;
};

export function periodsFor(today: string): VenuePeriods {
  return {
    today: dayRange(today, 0),
    previousDay: dayRange(today, 1),
    thisWeek: weekRange(today, 0),
    previousWeek: weekRange(today, 1),
    thisMonth: monthRange(today, 0),
    previousMonth: monthRange(today, 1),
  };
}

/** A booking annotated with the venue context every period decision needs. */
type DatedBooking = BookingRow & {
  /** The booking's start date in ITS OWN venue's timezone. */
  localDate: string;
  periods: VenuePeriods;
};

function sumConfirmedRevenue(bookings: DatedBooking[], pick: (p: VenuePeriods) => LocalDateRange): number {
  return bookings
    .filter((b) => b.status === "confirmed" && isWithin(b.localDate, pick(b.periods)))
    .reduce((sum, b) => sum + b.price_amount, 0);
}

function revenuePeriod(
  bookings: DatedBooking[],
  current: (p: VenuePeriods) => LocalDateRange,
  previous: (p: VenuePeriods) => LocalDateRange
): RevenuePeriod {
  const amount = sumConfirmedRevenue(bookings, current);
  const previousAmount = sumConfirmedRevenue(bookings, previous);
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
 * Total open hours for one venue across an INCLUSIVE venue-local date
 * range, derived by walking each calendar day in the range and summing
 * whichever `venue_operating_hours` rows match that day's day-of-week.
 * A cheap, documented approximation — like the operating-hours approach
 * used for availability search — not a timezone-exact wall-clock
 * calculation, since bookings are what's being measured against, not a
 * live slot check. It walks the same venue-local calendar days the
 * bookings above are bucketed into.
 */
export function openHoursInRange(operatingHours: OperatingHoursRow[], venueId: string, range: LocalDateRange): number {
  const rowsForVenue = operatingHours.filter((r) => r.venue_id === venueId);
  if (rowsForVenue.length === 0) return 0;

  let total = 0;
  for (let day = range.from; day <= range.to; day = shiftDate(day, 1)) {
    const dow = weekdayOf(day);
    for (const row of rowsForVenue) {
      if (row.day_of_week === dow) {
        total += (hmsToMinutes(row.end_time) - hmsToMinutes(row.start_time)) / 60;
      }
    }
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
  // One lookup per booking instead of a courts.find() scan inside every
  // per-booking loop below — and the venue is what carries the timezone
  // each booking's business day is decided in.
  const venueByCourtId = new Map(
    courts.flatMap((c) => {
      const venue = venuesById.get(c.venue_id);
      return venue ? ([[c.id, venue]] as [string, (typeof venue)][]) : [];
    })
  );

  const now = new Date();
  // Periods are per-timezone, and an owner's venues need not share one.
  const periodsByTimezone = new Map<string, VenuePeriods>();
  const periodsForTimezone = (timezone: string): VenuePeriods => {
    const cached = periodsByTimezone.get(timezone);
    if (cached) return cached;
    const fresh = periodsFor(localDateIn(now, timezone));
    periodsByTimezone.set(timezone, fresh);
    return fresh;
  };

  // The fetch window is instant-based and only has to be a SUPERSET of
  // the venue-local months we bucket into — one day of slack each side
  // covers every real UTC offset (max ±14h).
  const utcNow = localDateIn(now, "UTC");
  const fetchFrom = `${shiftDate(monthRange(utcNow, 1).from, -1)}T00:00:00.000Z`;
  const fetchTo = `${shiftDate(monthRange(utcNow, 0).to, 1)}T23:59:59.999Z`;

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("court_id, user_id, price_amount, currency, status, start_time, end_time")
    .in("court_id", courtIds)
    .gte("start_time", fetchFrom)
    .lte("start_time", fetchTo);
  if (bookingsError) throw bookingsError;

  const datedBookings: DatedBooking[] = ((bookings ?? []) as BookingRow[]).map((row) => {
    const timezone = venueByCourtId.get(row.court_id)?.timezone ?? "Asia/Manila";
    return {
      ...row,
      localDate: localDateIn(new Date(row.start_time), timezone),
      periods: periodsForTimezone(timezone),
    };
  });

  const currency = datedBookings.find((b) => b.status === "confirmed")?.currency ?? DEFAULT_CURRENCY;

  const revenue = {
    today: revenuePeriod(
      datedBookings,
      (p) => p.today,
      (p) => p.previousDay
    ),
    thisWeek: revenuePeriod(
      datedBookings,
      (p) => p.thisWeek,
      (p) => p.previousWeek
    ),
    thisMonth: revenuePeriod(
      datedBookings,
      (p) => p.thisMonth,
      (p) => p.previousMonth
    ),
  };

  const monthBookings = datedBookings.filter((b) => isWithin(b.localDate, b.periods.thisMonth));
  const activeMonthBookings = monthBookings.filter((b) => b.status !== "cancelled");

  const { data: operatingHours, error: ohError } = await supabase
    .from("venue_operating_hours")
    .select("venue_id, day_of_week, start_time, end_time")
    .in("venue_id", Array.from(venuesById.keys()));
  if (ohError) throw ohError;
  const operatingHoursRows = (operatingHours ?? []) as OperatingHoursRow[];

  const bookedHoursByCourtId = new Map<string, number>();
  const bookingCountByCourtId = new Map<string, number>();
  for (const b of activeMonthBookings) {
    bookedHoursByCourtId.set(b.court_id, (bookedHoursByCourtId.get(b.court_id) ?? 0) + hoursBetween(b.start_time, b.end_time));
    bookingCountByCourtId.set(b.court_id, (bookingCountByCourtId.get(b.court_id) ?? 0) + 1);
  }

  const perCourt: CourtOccupancy[] = courts.map((court) => {
    const venue = venuesById.get(court.venue_id);
    // Month-to-date in the venue's own calendar: from the 1st through
    // today inclusive. Counting the whole month would compare bookings
    // that exist against open hours that haven't happened yet.
    const openHours = venue
      ? openHoursInRange(operatingHoursRows, venue.id, {
          from: periodsForTimezone(venue.timezone).thisMonth.from,
          to: localDateIn(now, venue.timezone),
        })
      : 0;
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
    const hour = localStartHour(b.start_time, venueByCourtId.get(b.court_id)?.timezone ?? "Asia/Manila");
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
