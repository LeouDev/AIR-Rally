import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, BookingStatus } from "@/lib/supabase/types";
import { listVenuesByOwner } from "@/lib/services/venues";
import { getOwnerCourtSchedule, todayInTimezone } from "@/lib/services/ownerAvailability";

type Client = SupabaseClient<Database>;

/** Postgres error code for a malformed UUID literal — same pattern as venues.ts#getVenueDetail. */
const POSTGRES_INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * The owner-safe booking shape, used for both list rows and the single-
 * booking detail view (Phase 3.1/3.2 — they're the same fields, so one
 * type serves both rather than inventing a near-duplicate "detail" type).
 *
 * Deliberately an explicit column allowlist at the QUERY level, not a
 * `select("*")` + remap — every function below names exactly the
 * `bookings` columns it selects, so stripe_checkout_session_id,
 * stripe_payment_intent_id, paymongo_checkout_session_id,
 * paymongo_payment_intent_id, and paymongo_venue_account_id never leave
 * Postgres in the first place, not just "never get returned." Customer
 * identity is joined through public_profiles (id, display_name,
 * avatar_url only) — venue owners have no RLS access to another user's
 * raw profiles row, same posture get_owner_court_schedule() already
 * established for the calendar.
 */
export type OwnerBookingWithDetails = {
  id: string;
  courtId: string;
  courtName: string;
  venueId: string;
  venueName: string;
  venueTimezone: string;
  customerName: string;
  customerAvatarUrl: string | null;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  priceAmount: number;
  currency: string;
  paymentProvider: "stripe" | "paymongo";
  paidAt: string | null;
  confirmationCode: string;
  createdAt: string;
};

const BOOKING_COLUMNS =
  "id, court_id, user_id, start_time, end_time, status, price_amount, currency, payment_provider, paid_at, confirmation_code, created_at";

type CourtRow = { id: string; name: string; venue_id: string };
type VenueRow = { id: string; name: string; timezone: string };

/**
 * All courts belonging to any venue this owner owns, plus the venues
 * themselves — reused by both list/detail functions below. Deliberately
 * two flat queries, not a `courts(...).select("venues(name, timezone)")`
 * PostgREST embed: an embed silently applies the *embedded* table's own
 * RLS and can drop rows unexpectedly (see venueEarnings.ts, which
 * established this "fetch parents, then children/siblings separately"
 * pattern for exactly this reason). RLS on `courts` already scopes this
 * correctly on its own (owner-via-venues-join, same policy
 * CourtsManager already relies on) — the `listVenuesByOwner` call isn't
 * a permission pre-check, it's also where the venue name/timezone comes
 * from, and it lets a caller with zero venues get an early, cheap `[]`.
 */
async function listOwnerCourtsWithVenue(
  supabase: Client,
  ownerId: string
): Promise<{ courts: CourtRow[]; venuesById: Map<string, VenueRow> }> {
  const venues = await listVenuesByOwner(supabase, ownerId);
  if (venues.length === 0) return { courts: [], venuesById: new Map() };

  const venuesById = new Map(venues.map((v) => [v.id, { id: v.id, name: v.name, timezone: v.timezone }]));

  const { data, error } = await supabase
    .from("courts")
    .select("id, name, venue_id")
    .in(
      "venue_id",
      venues.map((v) => v.id)
    );
  if (error) throw error;
  return { courts: data ?? [], venuesById };
}

/**
 * Bookings for any of this owner's courts, upcoming or past (relative to
 * now), joined with court/venue names and the customer's public display
 * name. Grouping by venue then court (Phase 3.1) happens in the caller —
 * this returns a flat, sorted list, since the grouping is a rendering
 * concern, not a second query.
 */
export async function listBookingsForOwner(
  supabase: Client,
  ownerId: string,
  when: "upcoming" | "past"
): Promise<OwnerBookingWithDetails[]> {
  const { courts, venuesById } = await listOwnerCourtsWithVenue(supabase, ownerId);
  if (courts.length === 0) return [];
  const courtById = new Map(courts.map((c) => [c.id, c]));

  const nowIso = new Date().toISOString();
  let query = supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .in(
      "court_id",
      courts.map((c) => c.id)
    );
  query =
    when === "upcoming"
      ? query.gte("start_time", nowIso).order("start_time", { ascending: true })
      : query.lt("start_time", nowIso).order("start_time", { ascending: false });

  const { data: bookings, error: bookingsError } = await query;
  if (bookingsError) throw bookingsError;
  if (!bookings || bookings.length === 0) return [];

  const userIds = Array.from(new Set(bookings.map((b) => b.user_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  if (profilesError) throw profilesError;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return bookings.map((b) => {
    const court = courtById.get(b.court_id);
    const venue = court ? venuesById.get(court.venue_id) : undefined;
    const profile = profileById.get(b.user_id);
    return {
      id: b.id,
      courtId: b.court_id,
      courtName: court?.name ?? "Court",
      venueId: court?.venue_id ?? "",
      venueName: venue?.name ?? "Venue",
      venueTimezone: venue?.timezone ?? "Asia/Manila",
      customerName: profile?.display_name ?? "Player",
      customerAvatarUrl: profile?.avatar_url ?? null,
      startTime: b.start_time,
      endTime: b.end_time,
      status: b.status,
      priceAmount: b.price_amount,
      currency: b.currency,
      paymentProvider: b.payment_provider,
      paidAt: b.paid_at,
      confirmationCode: b.confirmation_code,
      createdAt: b.created_at,
    };
  });
}

/**
 * Single-booking detail for the owner-facing dialog (Phase 3.2). RLS
 * (the same owner-via-courts-join branch on `bookings`' SELECT policy)
 * means a booking that isn't at one of this caller's own courts simply
 * doesn't match — returns null, same "ownership-hidden looks like
 * not-found" shape as getVenueForOwner(), never a distinguishable error.
 */
export async function getBookingDetailForOwner(supabase: Client, bookingId: string): Promise<OwnerBookingWithDetails | null> {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError) {
    if (bookingError.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw bookingError;
  }
  if (!booking) return null;

  const { data: court, error: courtError } = await supabase
    .from("courts")
    .select("id, name, venue_id")
    .eq("id", booking.court_id)
    .maybeSingle();
  if (courtError) throw courtError;

  const { data: venue, error: venueError } = court
    ? await supabase.from("venues").select("name, timezone").eq("id", court.venue_id).maybeSingle()
    : { data: null, error: null };
  if (venueError) throw venueError;

  const { data: profile, error: profileError } = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .eq("id", booking.user_id)
    .maybeSingle();
  if (profileError) throw profileError;

  return {
    id: booking.id,
    courtId: booking.court_id,
    courtName: court?.name ?? "Court",
    venueId: court?.venue_id ?? "",
    venueName: venue?.name ?? "Venue",
    venueTimezone: venue?.timezone ?? "Asia/Manila",
    customerName: profile?.display_name ?? "Player",
    customerAvatarUrl: profile?.avatar_url ?? null,
    startTime: booking.start_time,
    endTime: booking.end_time,
    status: booking.status,
    priceAmount: booking.price_amount,
    currency: booking.currency,
    paymentProvider: booking.payment_provider,
    paidAt: booking.paid_at,
    confirmationCode: booking.confirmation_code,
    createdAt: booking.created_at,
  };
}

export type OwnerVenueTodaySummary = {
  venueId: string;
  venueName: string;
  bookingsToday: number;
  /** Slot count at the RPC's default 60-minute increment — one slot == one hour. */
  occupiedHours: number;
  availableHours: number;
};

export type OwnerDashboardSummary = {
  today: OwnerVenueTodaySummary[];
  thisWeek: {
    totalBookings: number;
    totalRevenue: number;
    currency: string;
    mostBookedCourtName: string | null;
  };
};

/** Sunday-to-Sunday, computed off UTC "now" — a deliberately simple
 * calendar-week boundary shared across every venue regardless of its own
 * timezone, rather than per-venue-timezone week math. Good enough for a
 * "this week" operational summary; not worth the complexity this phase. */
function currentWeekBoundsUtc(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Phase 3.3 dashboard summary. "Today, per venue" reuses
 * get_owner_court_schedule() — the same RPC the availability calendar
 * already calls, once per court — to derive occupied/available hours,
 * rather than reimplementing the operating-hours-minus-bookings-minus-
 * blocks merge in JS (this project's standing rule against duplicating
 * availability logic). This is an accepted O(courts) RPC-call pattern
 * for this phase's actual scale; not cached/materialized.
 */
export async function getOwnerDashboardSummary(supabase: Client, ownerId: string): Promise<OwnerDashboardSummary> {
  const venues = await listVenuesByOwner(supabase, ownerId);
  if (venues.length === 0) {
    return { today: [], thisWeek: { totalBookings: 0, totalRevenue: 0, currency: "PHP", mostBookedCourtName: null } };
  }

  const { data: courts, error: courtsError } = await supabase
    .from("courts")
    .select("id, name, venue_id")
    .in(
      "venue_id",
      venues.map((v) => v.id)
    );
  if (courtsError) throw courtsError;

  const courtsByVenue = new Map<string, { id: string; name: string }[]>();
  for (const c of courts ?? []) {
    const list = courtsByVenue.get(c.venue_id) ?? [];
    list.push({ id: c.id, name: c.name });
    courtsByVenue.set(c.venue_id, list);
  }

  const today: OwnerVenueTodaySummary[] = [];
  for (const venue of venues) {
    const venueCourts = courtsByVenue.get(venue.id) ?? [];
    const localDate = todayInTimezone(venue.timezone);
    let bookingsToday = 0;
    let occupiedHours = 0;
    let availableHours = 0;
    for (const court of venueCourts) {
      const schedule = await getOwnerCourtSchedule(supabase, court.id, localDate);
      for (const slot of schedule) {
        if (slot.status === "booked") {
          bookingsToday += 1;
          occupiedHours += 1;
        } else if (slot.status === "blocked") {
          occupiedHours += 1;
        } else if (slot.status === "available") {
          availableHours += 1;
        }
      }
    }
    today.push({ venueId: venue.id, venueName: venue.name, bookingsToday, occupiedHours, availableHours });
  }

  const allCourtIds = (courts ?? []).map((c) => c.id);
  let totalBookings = 0;
  let totalRevenue = 0;
  let currency = "PHP";
  let mostBookedCourtName: string | null = null;

  if (allCourtIds.length > 0) {
    const { start, end } = currentWeekBoundsUtc();
    const { data: weekBookings, error: weekError } = await supabase
      .from("bookings")
      .select("court_id, price_amount, currency, status")
      .in("court_id", allCourtIds)
      .gte("start_time", start)
      .lt("start_time", end);
    if (weekError) throw weekError;

    totalBookings = (weekBookings ?? []).length;
    const countByCourtId = new Map<string, number>();
    for (const b of weekBookings ?? []) {
      if (b.status === "confirmed") {
        totalRevenue += b.price_amount;
        currency = b.currency;
      }
      countByCourtId.set(b.court_id, (countByCourtId.get(b.court_id) ?? 0) + 1);
    }

    let maxCount = 0;
    let maxCourtId: string | null = null;
    for (const [courtId, count] of countByCourtId) {
      if (count > maxCount) {
        maxCount = count;
        maxCourtId = courtId;
      }
    }
    if (maxCourtId) {
      mostBookedCourtName = (courts ?? []).find((c) => c.id === maxCourtId)?.name ?? null;
    }
  }

  return { today, thisWeek: { totalBookings, totalRevenue, currency, mostBookedCourtName } };
}
