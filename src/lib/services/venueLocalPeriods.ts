/* -------------------------------------------------------------------------
 * Venue-local business periods.
 *
 * "Today" is a VENUE-LOCAL calendar day, never a UTC one. Every other
 * date surface in the product already works that way — availability
 * search takes a venue-local date, and localStartHour in ownerAnalytics
 * already derives the peak booking hour in the venue's own zone. Revenue
 * and the owner dashboard summary were the odd ones out: they sliced on
 * UTC midnight / a UTC calendar week, so for a Manila venue (UTC+8) an
 * owner's "Today"/"This week" ran on the wrong boundary and every
 * morning booking landed in the wrong bucket, dragging comparison arrows
 * and totals with it.
 *
 * Periods are handled as date-only "YYYY-MM-DD" strings rather than
 * instants: a calendar day has no single UTC extent once venues can sit
 * in different zones, and zero-padded ISO dates compare correctly with
 * plain string operators. Ranges are INCLUSIVE at both ends.
 *
 * Shared between getOwnerAnalytics (ownerAnalytics.ts) and
 * getOwnerDashboardSummary (ownerBookings.ts) so "this week" means the
 * same thing on both — the two disagreeing about the same owner's own
 * revenue, on the same site, is worse than either one being UTC-based:
 * see the fetch-window fix that added this module for the incident that
 * made that concrete.
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

/** Sunday-to-Saturday, matching day_of_week in venue_operating_hours. */
export function weekRange(today: string, weeksAgo: number): LocalDateRange {
  const from = shiftDate(today, -weekdayOf(today) - weeksAgo * 7);
  return { from, to: shiftDate(from, 6) };
}

/** January 1 to December 31, matching monthRange/weekRange's own shape — a full calendar period, not "to date". */
export function yearRange(today: string, yearsAgo: number): LocalDateRange {
  const [y] = today.split("-").map(Number);
  const year = y - yearsAgo;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
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

export type VenuePeriods = {
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

/**
 * The instant-based fetch window a Supabase query needs to be a superset
 * of every venue-local LocalDateRange this owner's venues could bucket
 * bookings into, across however many distinct timezones those venues
 * use. NOT derived from a single assumed calendar day/week/month (e.g.
 * "UTC's month") — that only bounds the instant `now` correctly, not the
 * venue-local range endpoints, which can carry a different date label
 * than UTC on either side of a boundary. One day of slack past the
 * earliest `from` and latest `to` absorbs any real UTC offset (max
 * ±14h) the venue-local -> instant conversion needs.
 */
export function fetchWindowFor(timezones: readonly string[], rangeFor: (periods: VenuePeriods) => LocalDateRange): { fetchFrom: string; fetchTo: string } {
  const now = new Date();
  const periodsByTimezone = new Map<string, VenuePeriods>();
  const periodsForTimezone = (timezone: string): VenuePeriods => {
    const cached = periodsByTimezone.get(timezone);
    if (cached) return cached;
    const fresh = periodsFor(localDateIn(now, timezone));
    periodsByTimezone.set(timezone, fresh);
    return fresh;
  };

  const seedRange = rangeFor(periodsForTimezone(timezones[0]));
  let earliest = seedRange.from;
  let latest = seedRange.to;
  for (const timezone of timezones) {
    const range = rangeFor(periodsForTimezone(timezone));
    if (range.from < earliest) earliest = range.from;
    if (range.to > latest) latest = range.to;
  }

  return {
    fetchFrom: `${shiftDate(earliest, -1)}T00:00:00.000Z`,
    fetchTo: `${shiftDate(latest, 1)}T23:59:59.999Z`,
  };
}
