import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { CommunityEvent, Database, EventAttendeeStatus, PublicProfile } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

type EventVenue = { id: string; name: string; city: string | null };

export type EventWithDetails = CommunityEvent & {
  creator: PublicProfile | null;
  venue: EventVenue | null;
  /** Seated players only — waitlisted and cancelled rows are excluded. */
  attendeeCount: number;
  /** True when max_players is set and every seat is taken. */
  isFull: boolean;
};

/** Upcoming, soonest first — batched creator/venue lookups, not one query per event. */
export async function listUpcomingEvents(supabase: Client, limit = 10): Promise<EventWithDetails[]> {
  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(limit);
  if (error) throw error;
  if (!events || events.length === 0) return [];

  const creatorIds = Array.from(new Set(events.map((e) => e.creator_id)));
  const venueIds = Array.from(new Set(events.map((e) => e.venue_id).filter((id): id is string => id !== null)));

  const [creatorsResult, venuesResult] = await Promise.all([
    supabase.from("public_profiles").select("*").in("id", creatorIds),
    venueIds.length > 0
      ? supabase.from("venues").select("id, name, city").in("id", venueIds)
      : Promise.resolve({ data: [] as EventVenue[], error: null }),
  ]);
  if (creatorsResult.error) throw creatorsResult.error;
  if (venuesResult.error) throw venuesResult.error;

  const creatorsById = new Map((creatorsResult.data ?? []).map((c) => [c.id, c]));
  const venuesById = new Map((venuesResult.data ?? []).map((v) => [v.id, v]));

  // participant_count is trigger-maintained, so the seated count comes
  // free with the row — no per-event attendee query needed at all.
  return events.map((event) => ({
    ...event,
    creator: creatorsById.get(event.creator_id) ?? null,
    venue: event.venue_id ? (venuesById.get(event.venue_id) ?? null) : null,
    attendeeCount: event.participant_count,
    isFull: event.max_players !== null && event.participant_count >= event.max_players,
  }));
}

/** Upcoming published events hosted by one club. */
export async function listEventsForClub(supabase: Client, clubId: string, limit = 20): Promise<CommunityEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("club_id", clubId)
    .neq("status", "draft")
    .order("start_time", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type CreateEventInput = {
  title: string;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  eventType?: CommunityEvent["event_type"];
  skillLevel?: CommunityEvent["skill_level"];
  venueId?: string | null;
  clubId?: string | null;
  courtId?: string | null;
  /**
   * The booking holding this event's court. Required whenever courtId is
   * set — RLS rejects an event that claims a court without a live booking
   * of the creator's own. The organizer creates that booking through the
   * ordinary booking flow, so hosting an event grants no special court
   * access to anyone.
   */
  bookingId?: string | null;
  maxPlayers?: number | null;
  /** Integer minor units. Display only in 7.8a — collected at the venue, never charged online. */
  priceAmount?: number;
};

export async function createEvent(supabase: Client, creatorId: string, values: CreateEventInput): Promise<CommunityEvent> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      creator_id: creatorId,
      title: values.title,
      description: values.description ?? null,
      start_time: values.startTime,
      end_time: values.endTime ?? null,
      event_type: values.eventType ?? "open_play",
      skill_level: values.skillLevel ?? null,
      venue_id: values.venueId ?? null,
      club_id: values.clubId ?? null,
      court_id: values.courtId ?? null,
      booking_id: values.bookingId ?? null,
      max_players: values.maxPlayers ?? null,
      price_amount: values.priceAmount ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelEvent(supabase: Client, eventId: string): Promise<void> {
  const { error } = await supabase.from("events").update({ status: "cancelled" }).eq("id", eventId);
  if (error) throw error;
}

/**
 * Joins an event. Whether the caller lands a seat or the waitlist is
 * decided by enforce_event_capacity() under a row lock on the event —
 * never here, because two concurrent joins racing in application code
 * would both see a free seat.
 *
 * Returns the status the database actually assigned. Idempotent: joining
 * twice re-activates the existing row rather than erroring.
 */
export async function joinEvent(supabase: Client, userId: string, eventId: string): Promise<EventAttendeeStatus> {
  const { data, error } = await supabase
    .from("event_attendees")
    .insert({ event_id: eventId, user_id: userId, status: "joined" })
    .select("status")
    .single();

  if (error) {
    if (!isUniqueViolation(error)) throw error;
    // Already has a row (likely previously cancelled) — reactivate it.
    const { data: updated, error: updateError } = await supabase
      .from("event_attendees")
      .update({ status: "joined" })
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .select("status")
      .single();
    if (updateError) throw updateError;
    return updated.status;
  }

  return data.status;
}

/**
 * Leaves an event. This is a status transition, not a delete — the row
 * has to survive so promote_event_waitlist() can see a seat was vacated
 * and move the longest-waiting player up.
 */
export async function leaveEvent(supabase: Client, userId: string, eventId: string): Promise<void> {
  const { error } = await supabase
    .from("event_attendees")
    .update({ status: "cancelled" })
    .eq("event_id", eventId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Batched — one query for a whole set of event ids, not one per card. */
export async function listAttendingEventIds(supabase: Client, userId: string, eventIds: string[]): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id")
    .eq("user_id", userId)
    .in("event_id", eventIds)
    .in("status", ["joined", "waitlisted"]);
  if (error) throw error;
  return (data ?? []).map((row) => row.event_id);
}


export type HostableBooking = {
  bookingId: string;
  courtId: string;
  courtName: string;
  venueName: string;
  startTime: string;
  endTime: string;
  priceAmount: number;
  currency: string;
  /** The game already opened on this booking, if any. */
  existingEventId: string | null;
};

/**
 * The caller's upcoming bookings, and whether each already has a game on
 * it. Only these can host an Open Play: the events RLS policy requires a
 * live booking of the creator's own before an event may claim a court, so
 * offering anything else would produce a policy rejection at submit time.
 *
 * Cancelled and past bookings are excluded — you cannot open a game on a
 * court you no longer hold, or on one that has already been played.
 */
export async function listHostableBookings(supabase: Client, userId: string): Promise<HostableBooking[]> {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, court_id, start_time, end_time, price_amount, currency, status, courts(name, venues(name))")
    .eq("user_id", userId)
    .in("status", ["pending", "confirmed"])
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(50);
  if (error) throw error;
  if (!bookings || bookings.length === 0) return [];

  const rows = bookings as unknown as {
    id: string;
    court_id: string;
    start_time: string;
    end_time: string;
    price_amount: number;
    currency: string;
    courts: { name: string; venues: { name: string } | null } | null;
  }[];

  // One query for every existing game rather than one per booking.
  const { data: events } = await supabase
    .from("events")
    .select("id, booking_id")
    .in("booking_id", rows.map((b) => b.id))
    .neq("status", "cancelled");
  const eventByBooking = new Map((events ?? []).map((e) => [e.booking_id, e.id]));

  return rows.map((booking) => ({
    bookingId: booking.id,
    courtId: booking.court_id,
    courtName: booking.courts?.name ?? "Court",
    venueName: booking.courts?.venues?.name ?? "Venue",
    startTime: booking.start_time,
    endTime: booking.end_time,
    priceAmount: booking.price_amount,
    currency: booking.currency,
    existingEventId: eventByBooking.get(booking.id) ?? null,
  }));
}
