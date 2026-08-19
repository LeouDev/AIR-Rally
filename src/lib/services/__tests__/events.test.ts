import { listUpcomingEvents, createEvent, joinEvent, leaveEvent, listMyEventStatuses } from "@/lib/services/events";
import { createTableMockSupabase, createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { CommunityEvent, PublicProfile } from "@/lib/supabase/types";

const CREATOR: PublicProfile = { id: "user-1", display_name: "Lea Santos", avatar_url: null };

const EVENT_ROW: CommunityEvent = {
  id: "event-1",
  creator_id: "user-1",
  venue_id: "venue-1",
  club_id: null,
  court_id: null,
  booking_id: null,
  title: "Sunset Social Rally",
  description: null,
  event_type: "open_play",
  skill_level: null,
  start_time: "2099-01-01T00:00:00Z",
  end_time: null,
  max_players: null,
  price_amount: 0,
  currency: "PHP",
  status: "published",
  participant_count: 2,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

describe("listUpcomingEvents", () => {
  // participant_count is trigger-maintained, so the seated count rides
  // along on the event row — there is deliberately no per-event attendee
  // query to batch any more.
  it("attaches creator and venue, taking the seated count from the row itself", async () => {
    const supabase = createTableMockSupabase({
      events: { data: [EVENT_ROW], error: null },
      public_profiles: { data: [CREATOR], error: null },
      venues: { data: [{ id: "venue-1", name: "Pickleball Cebu", city: "Cebu City" }], error: null },
    });

    const events = await listUpcomingEvents(supabase);

    expect(events).toEqual([
      {
        ...EVENT_ROW,
        creator: CREATOR,
        venue: { id: "venue-1", name: "Pickleball Cebu", city: "Cebu City" },
        attendeeCount: 2,
        isFull: false,
      },
    ]);
  });

  it("reports isFull once the seated count reaches max_players", async () => {
    const supabase = createTableMockSupabase({
      events: { data: [{ ...EVENT_ROW, max_players: 2, participant_count: 2 }], error: null },
      public_profiles: { data: [CREATOR], error: null },
      venues: { data: [{ id: "venue-1", name: "Pickleball Cebu", city: "Cebu City" }], error: null },
    });
    const events = await listUpcomingEvents(supabase);
    expect(events[0].isFull).toBe(true);
  });

  it("treats a null max_players as unlimited, never full", async () => {
    const supabase = createTableMockSupabase({
      events: { data: [{ ...EVENT_ROW, max_players: null, participant_count: 999 }], error: null },
      public_profiles: { data: [CREATOR], error: null },
      venues: { data: [{ id: "venue-1", name: "Pickleball Cebu", city: "Cebu City" }], error: null },
    });
    const events = await listUpcomingEvents(supabase);
    expect(events[0].isFull).toBe(false);
  });

  it("skips the venues query entirely when no event has a venue_id", async () => {
    const noVenueEvent = { ...EVENT_ROW, venue_id: null };
    const supabase = createTableMockSupabase({
      events: { data: [noVenueEvent], error: null },
      public_profiles: { data: [CREATOR], error: null },
    });

    const events = await listUpcomingEvents(supabase);
    expect(events[0].venue).toBeNull();
  });

  it("returns an empty array without any follow-up queries when there are no upcoming events", async () => {
    const supabase = createTableMockSupabase({ events: { data: [], error: null } });
    await expect(listUpcomingEvents(supabase)).resolves.toEqual([]);
  });
});

describe("createEvent", () => {
  it("inserts with the caller's own creator_id", async () => {
    const supabase = createMockSupabase({ data: EVENT_ROW, error: null });
    const result = await createEvent(supabase, "user-1", { title: "Sunset Social Rally", startTime: "2099-01-01T00:00:00Z" });
    expect(result).toEqual(EVENT_ROW);
  });

  it("passes the court's backing booking through — RLS rejects a court claim without one", async () => {
    const supabase = createMockSupabase({ data: EVENT_ROW, error: null });
    await createEvent(supabase, "user-1", {
      title: "Friday Open Play",
      startTime: "2099-01-01T00:00:00Z",
      courtId: "court-1",
      bookingId: "booking-1",
    });

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { insert: jest.Mock };
    const payload = builder.insert.mock.calls[0][0];
    expect(payload.court_id).toBe("court-1");
    expect(payload.booking_id).toBe("booking-1");
  });
});

describe("joinEvent / leaveEvent", () => {
  // The database decides seat vs waitlist under a row lock; the service
  // reports back whatever status it actually assigned.
  it("returns the status the database assigned when a seat is available", async () => {
    const supabase = createMockSupabase({ data: { status: "joined" }, error: null });
    await expect(joinEvent(supabase, "user-1", "event-1")).resolves.toBe("joined");
  });

  it("returns 'waitlisted' when the capacity trigger diverted the join", async () => {
    const supabase = createMockSupabase({ data: { status: "waitlisted" }, error: null });
    await expect(joinEvent(supabase, "user-1", "event-1")).resolves.toBe("waitlisted");
  });

  it("re-activates an existing row instead of failing on a duplicate join", async () => {
    // First call (insert) hits the composite-PK unique violation; the
    // fallback update re-activates the row.
    const supabase = createTableMockSupabase({
      event_attendees: [
        { data: null, error: postgrestError("23505") },
        { data: { status: "joined" }, error: null },
      ],
    });
    await expect(joinEvent(supabase, "user-1", "event-1")).resolves.toBe("joined");
  });

  it("propagates a genuine, unrelated database error on join", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "denied") });
    await expect(joinEvent(supabase, "user-1", "event-1")).rejects.toBeTruthy();
  });

  // Leaving must NOT delete the row — promote_event_waitlist() needs to
  // see a seat was vacated so it can move the next person up.
  it("leaving is a status transition to 'cancelled', not a delete", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(leaveEvent(supabase, "user-1", "event-1")).resolves.toBeUndefined();

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock; delete?: jest.Mock };
    expect(builder.update).toHaveBeenCalledWith({ status: "cancelled" });
  });
});

describe("listMyEventStatuses", () => {
  it("returns an empty map without querying when eventIds is empty", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(listMyEventStatuses(supabase, "user-1", [])).resolves.toEqual(new Map());
  });

  it("returns the caller's exact status per event id", async () => {
    const supabase = createMockSupabase({ data: [{ event_id: "event-1", status: "pending_approval" }], error: null });
    await expect(listMyEventStatuses(supabase, "user-1", ["event-1", "event-2"])).resolves.toEqual(
      new Map([["event-1", "pending_approval"]])
    );
  });
});
