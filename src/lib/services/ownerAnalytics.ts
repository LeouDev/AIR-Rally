import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { listOwnerCourtsWithVenue } from "@/lib/services/ownerBookings";
import {
  type LocalDateRange,
  type VenuePeriods,
  localDateIn,
  shiftDate,
  weekdayOf,
  isWithin,
  periodsFor,
  fetchWindowFor,
  yearRange,
} from "@/lib/services/venueLocalPeriods";

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

/**
 * "Today"/"this week"/"this month" are VENUE-LOCAL calendar periods, never
 * UTC ones — see venueLocalPeriods.ts for why and for the date-math these
 * share with getOwnerDashboardSummary (ownerBookings.ts), which buckets
 * "this week" through the exact same LocalDateRange/periodsFor so the two
 * owner-facing revenue surfaces can't disagree about what week it is.
 */

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

  // The fetch window must be a superset of the venue-local months we
  // bucket into — and "venue-local", not UTC's, is the operative word.
  // An earlier version anchored this on monthRange(UTC's date), which
  // only bounds the *instant* correctly; it does nothing for the window
  // *endpoints* once a venue's local calendar month has a different
  // label than UTC's. For a Manila venue (UTC+8) in the first eight
  // hours of a new local month, "this month" was already September
  // locally while UTC's date was still August 31st — so fetchTo, built
  // from August, ended before September's bookings even began, and
  // every metric fed by monthBookings (occupancy, peak/lowest hour,
  // most-booked courts, total bookings, repeat customers, cancellation
  // rate) under-reported along with revenue. A venue behind UTC loses
  // the opposite end: previousMonth truncates instead.
  //
  // So the window is derived from the actual venue-local ranges being
  // bucketed into, across every timezone this owner's venues use — not
  // from a single assumed calendar month. One day of slack past the
  // earliest previousMonth.from and latest thisMonth.to absorbs any real
  // UTC offset (max ±14h) the venue-local -> instant conversion needs.
  const timezonesInPlay = [...new Set(courts.map((c) => venuesById.get(c.venue_id)?.timezone ?? "Asia/Manila"))];
  const { fetchFrom, fetchTo } = fetchWindowFor(timezonesInPlay, (p) => ({ from: p.previousMonth.from, to: p.thisMonth.to }));

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

export type RangeSummary = {
  amount: number;
  bookingCount: number;
  currency: string;
};

/**
 * Revenue + booking count for one arbitrary venue-local date range —
 * the custom-range filter on the earnings page. Deliberately separate
 * from getOwnerAnalytics() above rather than folded into its existing
 * fixed today/week/month window: that function's fetch window is
 * already carefully tuned to the narrowest range those three periods
 * need, and widening it to cover an arbitrary caller-supplied range
 * would risk the exact class of bug this module's own history is about
 * (see the header comment on getOwnerAnalytics) for no benefit — this
 * is a second, independent fetch, not a fourth period bolted onto the
 * first.
 *
 * No prior-period comparison, unlike the three fixed periods: an
 * arbitrary custom range has no obvious "previous" range to compare
 * against (unlike a week or a month, which have a clear predecessor).
 * Simpler figure, not a missing feature.
 */
export async function getOwnerRevenueForRange(supabase: Client, ownerId: string, range: LocalDateRange): Promise<RangeSummary> {
  const empty: RangeSummary = { amount: 0, bookingCount: 0, currency: DEFAULT_CURRENCY };
  const { courts, venuesById } = await listOwnerCourtsWithVenue(supabase, ownerId);
  if (courts.length === 0) return empty;

  const venueByCourtId = new Map(
    courts.flatMap((c) => {
      const venue = venuesById.get(c.venue_id);
      return venue ? ([[c.id, venue]] as [string, (typeof venue)][]) : [];
    })
  );

  const timezonesInPlay = [...new Set(courts.map((c) => venuesById.get(c.venue_id)?.timezone ?? "Asia/Manila"))];
  const { fetchFrom, fetchTo } = fetchWindowFor(timezonesInPlay, () => range);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("court_id, price_amount, currency, status, start_time")
    .in(
      "court_id",
      courts.map((c) => c.id)
    )
    .gte("start_time", fetchFrom)
    .lte("start_time", fetchTo);
  if (error) throw error;

  let amount = 0;
  let bookingCount = 0;
  let currency = DEFAULT_CURRENCY;
  for (const b of bookings ?? []) {
    const timezone = venueByCourtId.get(b.court_id)?.timezone ?? "Asia/Manila";
    const localDate = localDateIn(new Date(b.start_time), timezone);
    if (!isWithin(localDate, range)) continue;
    bookingCount += 1;
    if (b.status === "confirmed") {
      amount += b.price_amount;
      currency = b.currency;
    }
  }
  return { amount, bookingCount, currency };
}

/**
 * "This year" revenue, with a same-length prior-year comparison — the
 * one fixed period the founder asked for that getOwnerAnalytics() above
 * doesn't already cover. Its own fetch (this year plus last year, one
 * query) rather than reusing getOwnerRevenueForRange() twice, for the
 * same reason today/week/month share one fetch above: one dataset,
 * bucketed twice, instead of two round trips.
 */
export async function getOwnerYearRevenue(supabase: Client, ownerId: string): Promise<RevenuePeriod> {
  const empty: RevenuePeriod = { amount: 0, previousAmount: 0, changePct: null };
  const { courts, venuesById } = await listOwnerCourtsWithVenue(supabase, ownerId);
  if (courts.length === 0) return empty;

  const venueByCourtId = new Map(
    courts.flatMap((c) => {
      const venue = venuesById.get(c.venue_id);
      return venue ? ([[c.id, venue]] as [string, (typeof venue)][]) : [];
    })
  );

  const now = new Date();
  const timezonesInPlay = [...new Set(courts.map((c) => venuesById.get(c.venue_id)?.timezone ?? "Asia/Manila"))];
  const periodsByTimezone = new Map<string, { thisYear: LocalDateRange; previousYear: LocalDateRange }>();
  const yearsForTimezone = (timezone: string) => {
    const cached = periodsByTimezone.get(timezone);
    if (cached) return cached;
    const today = localDateIn(now, timezone);
    const fresh = { thisYear: yearRange(today, 0), previousYear: yearRange(today, 1) };
    periodsByTimezone.set(timezone, fresh);
    return fresh;
  };

  // fetchWindowFor's callback signature expects VenuePeriods, and years
  // aren't part of that shape — the widest window across every
  // timezone in play (previous year's start to this year's end) is
  // computed directly instead of forcing this into fetchWindowFor's own
  // type, same ±1-day padding it applies.
  let earliest = "9999-12-31";
  let latest = "0000-01-01";
  for (const timezone of timezonesInPlay) {
    const { thisYear, previousYear } = yearsForTimezone(timezone);
    if (previousYear.from < earliest) earliest = previousYear.from;
    if (thisYear.to > latest) latest = thisYear.to;
  }
  const realFetchFrom = `${shiftDate(earliest, -1)}T00:00:00.000Z`;
  const realFetchTo = `${shiftDate(latest, 1)}T23:59:59.999Z`;

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("court_id, price_amount, currency, status, start_time")
    .in(
      "court_id",
      courts.map((c) => c.id)
    )
    .gte("start_time", realFetchFrom)
    .lte("start_time", realFetchTo);
  if (error) throw error;

  let amount = 0;
  let previousAmount = 0;
  for (const b of bookings ?? []) {
    if (b.status !== "confirmed") continue;
    const timezone = venueByCourtId.get(b.court_id)?.timezone ?? "Asia/Manila";
    const localDate = localDateIn(new Date(b.start_time), timezone);
    const { thisYear, previousYear } = yearsForTimezone(timezone);
    if (isWithin(localDate, thisYear)) amount += b.price_amount;
    else if (isWithin(localDate, previousYear)) previousAmount += b.price_amount;
  }

  const changePct = previousAmount === 0 ? null : (amount - previousAmount) / previousAmount;
  return { amount, previousAmount, changePct };
}
