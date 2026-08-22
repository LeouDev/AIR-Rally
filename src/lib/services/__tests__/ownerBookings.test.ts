/**
 * @jest-environment node
 */
import { listBookingsForOwner, getBookingDetailForOwner, getOwnerDashboardSummary } from "../ownerBookings";
import { createTableMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";

const SAFE_BOOKING_KEYS = [
  "id",
  "courtId",
  "courtName",
  "venueId",
  "venueName",
  "venueTimezone",
  "customerName",
  "customerAvatarUrl",
  "startTime",
  "endTime",
  "status",
  "priceAmount",
  "currency",
  "paymentProvider",
  "paidAt",
  "cancelledAt",
  "confirmationCode",
  "createdAt",
].sort();

const venueRow = { id: "venue-1", name: "Banilad Pickle Club", timezone: "Asia/Manila" };
const courtRow = { id: "court-1", name: "Court 1", venue_id: "venue-1" };
const bookingRow = {
  id: "booking-1",
  court_id: "court-1",
  user_id: "user-1",
  start_time: "2026-08-20T01:00:00Z",
  end_time: "2026-08-20T02:00:00Z",
  status: "confirmed",
  price_amount: 1000,
  currency: "PHP",
  payment_provider: "paymongo",
  paid_at: "2026-08-19T00:00:00Z",
  cancelled_at: null,
  confirmation_code: "ABC123",
  created_at: "2026-08-18T00:00:00Z",
  // Provider-secret columns that must never leave this module, even if
  // a future `select("*")`-style change accidentally widened the query.
  stripe_checkout_session_id: "cs_test_secret",
  stripe_payment_intent_id: "pi_test_secret",
  paymongo_checkout_session_id: "cs_pm_secret",
  paymongo_payment_intent_id: "pi_pm_secret",
  paymongo_venue_account_id: "acct_secret",
};
const profileRow = { id: "user-1", display_name: "Jane Player", avatar_url: null };

describe("listBookingsForOwner", () => {
  it("returns an empty list without querying courts/bookings when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    const result = await listBookingsForOwner(supabase, "owner-1", "upcoming");
    expect(result).toEqual([]);
  });

  it("returns an empty list when the owner has venues but no courts", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: [], error: null },
    });
    const result = await listBookingsForOwner(supabase, "owner-1", "upcoming");
    expect(result).toEqual([]);
  });

  it("maps bookings joined with court/venue/customer names, and never exposes payment-provider secret columns", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: [courtRow], error: null },
      bookings: { data: [bookingRow], error: null },
      public_profiles: { data: [profileRow], error: null },
    });

    const result = await listBookingsForOwner(supabase, "owner-1", "upcoming");

    expect(result).toEqual([
      {
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
        paidAt: "2026-08-19T00:00:00Z",
        cancelledAt: null,
        confirmationCode: "ABC123",
        createdAt: "2026-08-18T00:00:00Z",
      },
    ]);
    expect(Object.keys(result[0]).sort()).toEqual(SAFE_BOOKING_KEYS);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/stripe_|paymongo_venue_account_id|checkout_session|payment_intent/);
  });

  it("scopes the bookings query to the owner's own court ids via .in()", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: [courtRow], error: null },
      bookings: { data: [], error: null },
    });
    const fromSpy = supabase.from as unknown as jest.Mock;
    await listBookingsForOwner(supabase, "owner-1", "upcoming");
    const bookingsCallIndex = fromSpy.mock.calls.findIndex(([table]: [string]) => table === "bookings");
    expect(bookingsCallIndex).toBeGreaterThanOrEqual(0);
    const builder = fromSpy.mock.results[bookingsCallIndex].value as { in: jest.Mock };
    expect(builder.in).toHaveBeenCalledWith("court_id", ["court-1"]);
  });

  it("falls back to safe placeholder names when a court or profile can't be resolved", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: [venueRow], error: null },
      courts: { data: [courtRow], error: null },
      bookings: { data: [{ ...bookingRow, court_id: "some-other-court" }], error: null },
      public_profiles: { data: [], error: null },
    });
    const result = await listBookingsForOwner(supabase, "owner-1", "upcoming");
    expect(result[0].courtName).toBe("Court");
    expect(result[0].venueName).toBe("Venue");
    expect(result[0].venueTimezone).toBe("Asia/Manila");
    expect(result[0].customerName).toBe("Player");
  });
});

describe("getBookingDetailForOwner", () => {
  it("returns null when RLS hides the booking (not found, indistinguishable from non-owned)", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: null, error: null } });
    const result = await getBookingDetailForOwner(supabase, "booking-404");
    expect(result).toBeNull();
  });

  it("returns null (not a thrown error) for a malformed booking id", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: null, error: postgrestError("22P02") } });
    const result = await getBookingDetailForOwner(supabase, "not-a-uuid");
    expect(result).toBeNull();
  });

  it("propagates a real database error", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: null, error: postgrestError("42501") } });
    await expect(getBookingDetailForOwner(supabase, "booking-1")).rejects.toMatchObject({ code: "42501" });
  });

  it("returns full safe detail, joined with court/venue/customer, no secret columns", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: bookingRow, error: null },
      courts: { data: courtRow, error: null },
      venues: { data: venueRow, error: null },
      public_profiles: { data: profileRow, error: null },
    });

    const result = await getBookingDetailForOwner(supabase, "booking-1");

    expect(result).toMatchObject({
      id: "booking-1",
      courtName: "Court 1",
      venueName: "Banilad Pickle Club",
      venueTimezone: "Asia/Manila",
      customerName: "Jane Player",
    });
    expect(Object.keys(result!).sort()).toEqual(SAFE_BOOKING_KEYS);
  });
});

describe("getOwnerDashboardSummary", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns a zero-state summary without querying courts/bookings when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    const result = await getOwnerDashboardSummary(supabase, "owner-1");
    expect(result).toEqual({
      today: [],
      thisWeek: { totalBookings: 0, totalRevenue: 0, currency: "PHP", mostBookedCourtName: null },
    });
  });

  it("tallies today's occupied/available hours per venue via the schedule RPC, and this week's totals from a direct query", async () => {
    // Thursday 2026-08-20, noon in Manila (UTC+8) — comfortably inside
    // the week, away from any day/week boundary so the fixture's dates
    // don't have to fight the assertion.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-20T04:00:00.000Z"));

    const courts = [
      { id: "court-1", name: "Court 1", venue_id: "venue-1" },
      { id: "court-2", name: "Court 2", venue_id: "venue-1" },
    ];
    const scheduleFixture = {
      data: [
        { slot_start: "x", slot_end: "y", status: "booked", booking_id: "b1", booking_status: "confirmed", customer_name: "A", block_id: null, block_reason: null },
        { slot_start: "x", slot_end: "y", status: "blocked", booking_id: null, booking_status: null, customer_name: null, block_id: "blk1", block_reason: "Maintenance" },
        { slot_start: "x", slot_end: "y", status: "available", booking_id: null, booking_status: null, customer_name: null, block_id: null, block_reason: null },
      ],
      error: null,
    };
    // All three land Wednesday 2026-08-19 in Manila — inside the same
    // venue-local week as the pinned "now" above.
    const weekBookings = [
      { court_id: "court-1", price_amount: 1000, currency: "PHP", status: "confirmed", start_time: "2026-08-19T04:00:00.000Z" },
      { court_id: "court-1", price_amount: 500, currency: "PHP", status: "pending", start_time: "2026-08-19T05:00:00.000Z" },
      { court_id: "court-2", price_amount: 2000, currency: "PHP", status: "confirmed", start_time: "2026-08-19T06:00:00.000Z" },
    ];

    const supabase = createTableMockSupabase(
      {
        venues: { data: [venueRow], error: null },
        courts: { data: courts, error: null },
        bookings: { data: weekBookings, error: null },
      },
      { get_owner_court_schedule: scheduleFixture }
    );

    const result = await getOwnerDashboardSummary(supabase, "owner-1");

    expect(result.today).toEqual([
      { venueId: "venue-1", venueName: "Banilad Pickle Club", bookingsToday: 2, occupiedHours: 4, availableHours: 2 },
    ]);
    expect(result.thisWeek).toEqual({
      totalBookings: 3,
      totalRevenue: 3000,
      currency: "PHP",
      mostBookedCourtName: "Court 1",
    });
  });

  it("buckets 'this week' by the venue's own local calendar, not a UTC Sunday-to-Sunday window — and matches getOwnerAnalytics' definition of a week", async () => {
    // Wednesday 2026-09-02, 03:00 in Manila (UTC+8) — barely past the
    // start of the venue-local week (Sunday 2026-08-30..09-05).
    jest.useFakeTimers().setSystemTime(new Date("2026-09-01T19:00:00.000Z"));

    const courts = [{ id: "court-1", name: "Court 1", venue_id: "venue-1" }];
    const scheduleFixture = { data: [], error: null };
    const weekBookings = [
      // Sunday 2026-08-30, 10:00 Manila — the first moment of "this
      // week" venue-local. A UTC Sunday-to-Sunday window computed off a
      // UTC "now" that's still 2026-09-01 would place this in the
      // PREVIOUS week and drop it.
      { court_id: "court-1", price_amount: 1500, currency: "PHP", status: "confirmed", start_time: "2026-08-30T02:00:00.000Z" },
      // Two days before "this week" venue-local (Friday 2026-08-28) —
      // must never be counted.
      { court_id: "court-1", price_amount: 9999, currency: "PHP", status: "confirmed", start_time: "2026-08-28T02:00:00.000Z" },
    ];

    const supabase = createTableMockSupabase(
      {
        venues: { data: [venueRow], error: null },
        courts: { data: courts, error: null },
        bookings: { data: weekBookings, error: null },
      },
      { get_owner_court_schedule: scheduleFixture }
    );

    const result = await getOwnerDashboardSummary(supabase, "owner-1");

    expect(result.thisWeek).toEqual({
      totalBookings: 1,
      totalRevenue: 1500,
      currency: "PHP",
      mostBookedCourtName: "Court 1",
    });
  });
});
