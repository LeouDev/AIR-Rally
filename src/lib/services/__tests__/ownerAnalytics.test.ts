/**
 * @jest-environment node
 */
import { getOwnerAnalytics, getOwnerRevenueForRange, getOwnerYearRevenue } from "../ownerAnalytics";
import { createTableMockSupabase } from "../../test-helpers/mockSupabase";

/**
 * The shared mock's query builder (createTableMockSupabase) ignores every
 * filter method — .gte()/.lte()/.in() are all no-ops that just return the
 * fixture verbatim. That is fine for tests that only care about the SHAPE
 * of a query, but it means a bug in the fetch window itself — the exact
 * class of bug this file exists to catch — can never fail against it: the
 * mock would hand back an out-of-window booking regardless of what dates
 * the code actually asked for.
 *
 * This wraps the same fixture, but the "bookings" table's builder really
 * filters by the recorded .gte("start_time", x)/.lte("start_time", y)
 * calls before resolving — so a wrong fetchFrom/fetchTo genuinely drops
 * rows here, the same way Postgres would drop them for real.
 */
function createFetchWindowAwareMockSupabase(tables: {
  venues: unknown[];
  courts: unknown[];
  bookings: Record<string, unknown>[];
  venue_operating_hours: unknown[];
}) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const bookingsBuilder: Record<string, unknown> = {
    select: jest.fn(() => bookingsBuilder),
    in: jest.fn(() => bookingsBuilder),
    gte: jest.fn((column: string, value: string) => {
      if (column === "start_time") filters.push((row) => (row.start_time as string) >= value);
      return bookingsBuilder;
    }),
    lte: jest.fn((column: string, value: string) => {
      if (column === "start_time") filters.push((row) => (row.start_time as string) <= value);
      return bookingsBuilder;
    }),
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve({ data: tables.bookings.filter((row) => filters.every((f) => f(row))), error: null }).then(onfulfilled, onrejected),
  };

  const other = createTableMockSupabase({
    venues: { data: tables.venues, error: null },
    courts: { data: tables.courts, error: null },
    venue_operating_hours: { data: tables.venue_operating_hours, error: null },
  });

  return {
    ...other,
    from: jest.fn((table: string) => (table === "bookings" ? bookingsBuilder : (other.from as (t: string) => unknown)(table))),
  } as unknown as Parameters<typeof getOwnerAnalytics>[0];
}

// Wednesday, 2026-08-19, 12:00 UTC — chosen so "today"/"this week"/"this
// month" all land on unambiguous, hand-computable UTC boundaries:
// this week = Aug 16 (Sun) .. Aug 23; this month = Aug 1 .. Sep 1.
const NOW = new Date("2026-08-19T12:00:00Z");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

const venueRow = { id: "venue-1", name: "Banilad Pickle Club", timezone: "UTC", owner_id: "owner-1" };
const courts = [
  { id: "court-1", name: "Court 1", venue_id: "venue-1" },
  { id: "court-2", name: "Court 2", venue_id: "venue-1" },
];

function booking(overrides: Partial<Record<string, unknown>>) {
  return {
    court_id: "court-1",
    user_id: "user-x",
    price_amount: 100,
    currency: "PHP",
    status: "confirmed",
    start_time: "2026-08-19T10:00:00Z",
    end_time: "2026-08-19T11:00:00Z",
    ...overrides,
  };
}

// A: today, confirmed. B: yesterday, confirmed (today's comparison baseline).
// C: this week (Mon), confirmed. D: last week, confirmed (week baseline).
// E: earlier this month, confirmed, 2nd booking for user-1 (repeat).
// F: last month, confirmed — only feeds the month-over-month baseline.
// G: this month, cancelled. H: this month, pending, 2nd booking for user-2 (repeat).
const bookingFixtures = [
  booking({ court_id: "court-1", user_id: "user-1", price_amount: 1000, start_time: "2026-08-19T10:00:00Z", end_time: "2026-08-19T11:00:00Z" }), // A
  booking({ court_id: "court-1", user_id: "user-2", price_amount: 500, start_time: "2026-08-18T14:00:00Z", end_time: "2026-08-18T15:00:00Z" }), // B
  booking({ court_id: "court-2", user_id: "user-1", price_amount: 300, start_time: "2026-08-17T10:00:00Z", end_time: "2026-08-17T11:00:00Z" }), // C
  booking({ court_id: "court-2", user_id: "user-3", price_amount: 700, start_time: "2026-08-10T18:00:00Z", end_time: "2026-08-10T19:00:00Z" }), // D
  booking({ court_id: "court-1", user_id: "user-1", price_amount: 400, start_time: "2026-08-03T10:00:00Z", end_time: "2026-08-03T11:00:00Z" }), // E
  booking({ court_id: "court-1", user_id: "user-4", price_amount: 900, start_time: "2026-07-15T10:00:00Z", end_time: "2026-07-15T11:00:00Z" }), // F
  booking({ court_id: "court-1", user_id: "user-2", price_amount: 200, status: "cancelled", start_time: "2026-08-05T10:00:00Z", end_time: "2026-08-05T11:00:00Z" }), // G
  booking({ court_id: "court-1", user_id: "user-2", price_amount: 150, status: "pending", start_time: "2026-08-12T10:00:00Z", end_time: "2026-08-12T11:00:00Z" }), // H
];

const operatingHours = [
  { venue_id: "venue-1", day_of_week: 0, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 1, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 2, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 3, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 4, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 5, start_time: "08:00:00", end_time: "20:00:00" },
  { venue_id: "venue-1", day_of_week: 6, start_time: "08:00:00", end_time: "20:00:00" },
];

describe("getOwnerAnalytics", () => {
  it("returns a zero-state result without querying courts/bookings when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    const result = await getOwnerAnalytics(supabase, "owner-1");
    expect(result).toEqual({
      currency: "PHP",
      revenue: {
        today: { amount: 0, previousAmount: 0, changePct: null },
        thisWeek: { amount: 0, previousAmount: 0, changePct: null },
        thisMonth: { amount: 0, previousAmount: 0, changePct: null },
      },
      occupancy: { perCourt: [], mostBookedCourts: [], peakHour: null, lowestHour: null },
      bookingInsights: { totalBookings: 0, repeatCustomers: 0, cancellationRate: 0 },
    });
  });

  // The fixture venue's timezone is "UTC", so its venue-local calendar
  // and the UTC calendar coincide and every number below is unchanged by
  // the venue-local period fix. The Manila case further down is what
  // exercises an offset.
  it("computes revenue, occupancy, and booking-insight figures against known boundaries", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: courts, error: null },
      bookings: { data: bookingFixtures, error: null },
      venue_operating_hours: { data: operatingHours, error: null },
    });

    const result = await getOwnerAnalytics(supabase, "owner-1");

    expect(result.currency).toBe("PHP");

    // today = Aug 19 (A: 1000), previous day = Aug 18 (B: 500)
    expect(result.revenue.today).toEqual({ amount: 1000, previousAmount: 500, changePct: 1 });
    // this week = Aug16-23 (A+B+C = 1800), last week = Aug9-16 (D = 700)
    expect(result.revenue.thisWeek.amount).toBe(1800);
    expect(result.revenue.thisWeek.previousAmount).toBe(700);
    expect(result.revenue.thisWeek.changePct).toBeCloseTo((1800 - 700) / 700);
    // this month = Aug (A+B+C+D+E = 2900), last month = Jul (F = 900)
    expect(result.revenue.thisMonth.amount).toBe(2900);
    expect(result.revenue.thisMonth.previousAmount).toBe(900);
    expect(result.revenue.thisMonth.changePct).toBeCloseTo((2900 - 900) / 900);

    // booking insights, scoped to this month (A,B,C,D,E,G,H = 7 rows)
    expect(result.bookingInsights.totalBookings).toBe(7);
    expect(result.bookingInsights.cancellationRate).toBeCloseTo(1 / 7);
    // user-1 (A,E) and user-2 (B,G) each have 2+ bookings this month
    expect(result.bookingInsights.repeatCustomers).toBe(2);

    // occupancy, active (non-cancelled) bookings this month: court-1 has
    // A,B,E,H = 4 booked hours; court-2 has C,D = 2 booked hours. 19 days
    // elapsed in August (1st through the 19th) x 12 open hours/day = 228.
    const court1 = result.occupancy.perCourt.find((c) => c.courtId === "court-1")!;
    const court2 = result.occupancy.perCourt.find((c) => c.courtId === "court-2")!;
    expect(court1.bookedHours).toBe(4);
    expect(court1.openHours).toBe(228);
    expect(court1.occupancyPct).toBeCloseTo(4 / 228);
    expect(court2.bookedHours).toBe(2);
    expect(court2.openHours).toBe(228);

    expect(result.occupancy.mostBookedCourts).toEqual([
      { courtId: "court-1", courtName: "Court 1", bookingCount: 4 },
      { courtId: "court-2", courtName: "Court 2", bookingCount: 2 },
    ]);

    // hour-of-day (UTC, since the fixture venue's timezone is "UTC"):
    // hour 10 has 4 bookings (A,C,E,H); hour 14 and 18 each have 1.
    expect(result.occupancy.peakHour).toBe(10);
    expect(result.occupancy.lowestHour).toBe(14);
  });

  /**
   * Revenue periods are venue-local calendar days, not UTC ones.
   *
   * The regression: these bounds used to be sliced on UTC midnight. For
   * a Manila venue (UTC+8) that meant an owner's "Today" actually ran
   * 8 AM to 8 AM, so every booking starting before 8 AM local was
   * counted against YESTERDAY — and, at a month boundary, against the
   * previous MONTH, which dragged the comparison percentages with it.
   */
  describe("venue-local period boundaries", () => {
    const manilaVenue = { id: "venue-1", name: "BGC Smash", timezone: "Asia/Manila", owner_id: "owner-1" };
    const oneCourt = [{ id: "court-1", name: "Court 1", venue_id: "venue-1" }];

    function analyticsFor(bookings: Record<string, unknown>[]) {
      return getOwnerAnalytics(
        createTableMockSupabase({
          venues: { data: [manilaVenue], error: null },
          courts: { data: oneCourt, error: null },
          bookings: { data: bookings, error: null },
          venue_operating_hours: { data: operatingHours, error: null },
        }),
        "owner-1"
      );
    }

    it("counts an early-morning Manila booking as today, not yesterday", async () => {
      // NOW is 2026-08-19T12:00Z = 8 PM Manila on the 19th.
      // 2026-08-18T23:00Z is 7 AM Manila on the 19th — the same Manila
      // day, but the previous UTC day.
      const result = await analyticsFor([
        booking({ price_amount: 1000, start_time: "2026-08-18T23:00:00Z", end_time: "2026-08-19T00:00:00Z" }),
      ]);

      expect(result.revenue.today.amount).toBe(1000);
      expect(result.revenue.today.previousAmount).toBe(0);
    });

    it("still counts a genuinely-previous Manila day as yesterday", async () => {
      // 2026-08-17T23:00Z is 7 AM Manila on the 18th — one Manila day back.
      const result = await analyticsFor([
        booking({ price_amount: 800, start_time: "2026-08-17T23:00:00Z", end_time: "2026-08-18T00:00:00Z" }),
      ]);

      expect(result.revenue.today.amount).toBe(0);
      expect(result.revenue.today.previousAmount).toBe(800);
    });

    it("keeps a first-of-the-month Manila morning booking in the new month", async () => {
      jest.setSystemTime(new Date("2026-09-01T04:00:00Z")); // noon Manila, 1 Sep
      // 2026-08-31T23:00Z is 7 AM Manila on 1 September — under UTC
      // bounds this landed in AUGUST.
      const result = await analyticsFor([
        booking({ price_amount: 600, start_time: "2026-08-31T23:00:00Z", end_time: "2026-09-01T00:00:00Z" }),
      ]);

      expect(result.revenue.thisMonth.amount).toBe(600);
      expect(result.revenue.thisMonth.previousAmount).toBe(0);
    });
  });

  /**
   * The fetch window itself — not just how a returned booking gets
   * bucketed. Every test above uses createTableMockSupabase, which
   * ignores .gte()/.lte() entirely, so none of them can fail against a
   * wrong fetchFrom/fetchTo — the exact reason the original
   * venue-local-periods branch shipped green at 6/6 while its fetch
   * window was still anchored on UTC's month. These use
   * createFetchWindowAwareMockSupabase instead, which really filters by
   * the dates the code asks for, so a regression here fails for real.
   */
  describe("fetch window — must be a superset of every venue-local period, not just UTC's month", () => {
    const manilaVenue = { id: "venue-1", name: "BGC Smash", timezone: "Asia/Manila", owner_id: "owner-1" };
    const nyVenue = { id: "venue-2", name: "Brooklyn Baseline", timezone: "America/New_York", owner_id: "owner-1" };
    const manilaCourt = { id: "court-1", name: "Court 1", venue_id: "venue-1" };
    const nyCourt = { id: "court-2", name: "Court 2", venue_id: "venue-2" };

    it("fetches a Manila booking on the 1st of the local month even when UTC is still on the last day of the prior month", async () => {
      // 2026-09-01T03:00 Manila = 2026-08-31T19:00Z. Venue-local "this
      // month" is already September; UTC's date is still August 31st. A
      // fetch window anchored on monthRange(UTC's date) ends before this
      // booking's start_time, so the DB would never return it.
      jest.setSystemTime(new Date("2026-08-31T19:00:00Z"));
      const midMonthBooking = booking({
        court_id: "court-1",
        price_amount: 1234,
        start_time: "2026-09-15T05:00:00Z", // Sept 15, 1 PM Manila — deep in "this month"
        end_time: "2026-09-15T06:00:00Z",
      });

      const result = await getOwnerAnalytics(
        createFetchWindowAwareMockSupabase({
          venues: [manilaVenue],
          courts: [manilaCourt],
          bookings: [midMonthBooking],
          venue_operating_hours: operatingHours,
        }),
        "owner-1"
      );

      expect(result.revenue.thisMonth.amount).toBe(1234);
      // Not just revenue: everything monthBookings feeds is exposed to
      // the same hole.
      expect(result.bookingInsights.totalBookings).toBe(1);
      expect(result.occupancy.mostBookedCourts).toEqual([{ courtId: "court-1", courtName: "Court 1", bookingCount: 1 }]);
      expect(result.occupancy.peakHour).toBe(13); // 1 PM Manila
    });

    it("fetches a Manila booking on the first day of the local week under the same boundary", async () => {
      jest.setSystemTime(new Date("2026-08-31T19:00:00Z")); // Sep 1, 03:00 Manila
      // Venue-local "this week" starting Sunday would be Aug 30 .. Sep 5.
      // Sept 3, 2 PM Manila is well inside it, but comfortably after the
      // UTC-month-anchored window's old end (Aug 31).
      const thisWeekBooking = booking({
        court_id: "court-1",
        price_amount: 777,
        start_time: "2026-09-03T06:00:00Z",
        end_time: "2026-09-03T07:00:00Z",
      });

      const result = await getOwnerAnalytics(
        createFetchWindowAwareMockSupabase({
          venues: [manilaVenue],
          courts: [manilaCourt],
          bookings: [thisWeekBooking],
          venue_operating_hours: operatingHours,
        }),
        "owner-1"
      );

      expect(result.revenue.thisWeek.amount).toBe(777);
    });

    it("fetches the head of 'previous month' for a venue BEHIND UTC (New York), the opposite-direction truncation", async () => {
      // 2026-08-31T22:00 New York (UTC-4 in August) = 2026-09-01T02:00Z.
      // Venue-local "today" is still Aug 31, so "previous month" is July
      // 1-31. A window anchored on UTC's date (already September) and
      // shifted back by monthRange(utcToday, 1) would land on August, not
      // July — truncating July down to nothing.
      jest.setSystemTime(new Date("2026-09-01T02:00:00Z"));
      const earlyJulyBooking = booking({
        court_id: "court-2",
        price_amount: 555,
        start_time: "2026-07-02T14:00:00Z", // July 2, 10 AM New York
        end_time: "2026-07-02T15:00:00Z",
      });

      const result = await getOwnerAnalytics(
        createFetchWindowAwareMockSupabase({
          venues: [nyVenue],
          courts: [nyCourt],
          bookings: [earlyJulyBooking],
          venue_operating_hours: [],
        }),
        "owner-1"
      );

      // "This month" is venue-local August (empty); "previous month" is
      // venue-local July, and must include the booking so the
      // month-over-month comparison isn't silently zeroed.
      expect(result.revenue.thisMonth.previousAmount).toBe(555);
    });

    it("unions the fetch window across an owner whose venues span two timezones, dropping neither", async () => {
      jest.setSystemTime(new Date("2026-08-31T19:00:00Z")); // Sep 1, 03:00 Manila / Aug 31, 15:00 New York
      const manilaBooking = booking({
        court_id: "court-1",
        price_amount: 1000,
        start_time: "2026-09-20T05:00:00Z", // deep in Manila's September
        end_time: "2026-09-20T06:00:00Z",
      });
      const nyBooking = booking({
        court_id: "court-2",
        price_amount: 2000,
        start_time: "2026-07-05T14:00:00Z", // deep in New York's previous month (July)
        end_time: "2026-07-05T15:00:00Z",
      });

      const result = await getOwnerAnalytics(
        createFetchWindowAwareMockSupabase({
          venues: [manilaVenue, nyVenue],
          courts: [manilaCourt, nyCourt],
          bookings: [manilaBooking, nyBooking],
          venue_operating_hours: operatingHours,
        }),
        "owner-1"
      );

      expect(result.revenue.thisMonth.amount).toBe(1000); // Manila's September booking
      expect(result.revenue.thisMonth.previousAmount).toBe(2000); // New York's July booking
    });
  });

  it("leaves occupancyPct null for a court whose venue has no operating hours configured", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: [courts[0]], error: null },
      bookings: { data: [bookingFixtures[0]], error: null },
      venue_operating_hours: { data: [], error: null },
    });

    const result = await getOwnerAnalytics(supabase, "owner-1");
    expect(result.occupancy.perCourt).toEqual([{ courtId: "court-1", courtName: "Court 1", bookedHours: 1, openHours: 0, occupancyPct: null }]);
  });
});

describe("getOwnerRevenueForRange", () => {
  it("returns a zero-state result when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    const result = await getOwnerRevenueForRange(supabase, "owner-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(result).toEqual({ amount: 0, bookingCount: 0, currency: "PHP" });
  });

  it("sums only confirmed bookings inside the given range, but counts every status inside it", async () => {
    const supabase = createFetchWindowAwareMockSupabase({
      venues: [venueRow],
      courts,
      bookings: [
        booking({ price_amount: 1000, status: "confirmed", start_time: "2026-08-05T10:00:00Z" }), // inside, confirmed
        booking({ price_amount: 9999, status: "confirmed", start_time: "2026-07-31T10:00:00Z" }), // outside (before range)
        booking({ price_amount: 500, status: "pending", start_time: "2026-08-10T10:00:00Z" }), // inside, not confirmed
      ],
      venue_operating_hours: operatingHours,
    });

    const result = await getOwnerRevenueForRange(supabase, "owner-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(result).toEqual({ amount: 1000, bookingCount: 2, currency: "PHP" });
  });
});

describe("getOwnerYearRevenue", () => {
  it("returns a zero-state result when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    const result = await getOwnerYearRevenue(supabase, "owner-1");
    expect(result).toEqual({ amount: 0, previousAmount: 0, changePct: null });
  });

  it("splits confirmed revenue between this year and last year, and computes the % change", async () => {
    // NOW = 2026-08-19: this year = 2026, previous year = 2025.
    const supabase = createFetchWindowAwareMockSupabase({
      venues: [venueRow],
      courts,
      bookings: [
        booking({ price_amount: 1000, status: "confirmed", start_time: "2026-03-01T10:00:00Z" }), // this year
        booking({ price_amount: 500, status: "confirmed", start_time: "2025-06-01T10:00:00Z" }), // previous year
        booking({ price_amount: 9999, status: "confirmed", start_time: "2024-06-01T10:00:00Z" }), // neither — must be excluded
        booking({ price_amount: 300, status: "pending", start_time: "2026-04-01T10:00:00Z" }), // this year, not confirmed — excluded from amount
      ],
      venue_operating_hours: operatingHours,
    });

    const result = await getOwnerYearRevenue(supabase, "owner-1");
    expect(result).toEqual({ amount: 1000, previousAmount: 500, changePct: 1 });
  });
});
