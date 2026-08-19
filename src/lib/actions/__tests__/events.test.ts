/**
 * @jest-environment node
 */
import { createEventAction, toggleEventJoinAction } from "../events";
import { getServerClient } from "../auth";
import { createEvent, joinEvent, leaveEvent } from "../../services/events";

// Relative paths, not the `@/` alias — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({
  getServerClient: jest.fn(),
}));
jest.mock("../../services/events", () => ({
  createEvent: jest.fn(),
  joinEvent: jest.fn(),
  leaveEvent: jest.fn(),
}));
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateEvent = createEvent as jest.MockedFunction<typeof createEvent>;
const mockJoinEvent = joinEvent as jest.MockedFunction<typeof joinEvent>;
const mockLeaveEvent = leaveEvent as jest.MockedFunction<typeof leaveEvent>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreateEvent.mockReset();
  mockJoinEvent.mockReset();
  mockLeaveEvent.mockReset();
});

describe("createEventAction", () => {
  it("rejects invalid input before ever reaching the service", async () => {
    const result = await createEventAction({ title: "", startTime: "not-a-date" });
    expect(result.success).toBe(false);
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createEventAction({ title: "Sunset Rally", startTime: "2099-01-01T00:00:00Z" });
    expect(result).toEqual({ success: false, error: "Sign in to create an event." });
  });

  it("creates the event as the authenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateEvent.mockResolvedValue({
      id: "event-1",
      creator_id: "user-1",
      venue_id: null,
      club_id: null,
      court_id: null,
      booking_id: null,
      title: "Sunset Rally",
      description: null,
      event_type: "open_play",
      skill_level: null,
      start_time: "2099-01-01T00:00:00Z",
      end_time: null,
      max_players: null,
      price_amount: 0,
      currency: "PHP",
      status: "published",
      participant_count: 0,
      created_at: "now",
      updated_at: "now",
    });
    const result = await createEventAction({ title: "Sunset Rally", startTime: "2099-01-01T00:00:00Z" });
    expect(result.success).toBe(true);
    expect(mockCreateEvent).toHaveBeenCalledWith(expect.anything(), "user-1", expect.objectContaining({ title: "Sunset Rally" }));
  });
});

describe("toggleEventJoinAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await toggleEventJoinAction("event-1", null);
    expect(result).toEqual({ success: false, error: "Sign in to join events." });
  });

  // Every non-creator join now starts pending_approval —
  // enforce_event_join_approval() (20260810000069) decides that, not
  // this action — so joinEvent()'s mocked return is what the action
  // must surface unchanged.
  it("joins when not currently attending", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockJoinEvent.mockResolvedValue("pending_approval");
    const result = await toggleEventJoinAction("event-1", null);
    expect(mockJoinEvent).toHaveBeenCalledWith(expect.anything(), "user-1", "event-1");
    expect(result).toEqual({ success: true, data: { status: "pending_approval" } });
  });

  // The capacity trigger, not this action, decides seat vs waitlist once
  // approved — so the action must surface what the database actually
  // assigned rather than optimistically reporting a seat.
  it("reports a waitlisted join when the event was already full", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockJoinEvent.mockResolvedValue("waitlisted");
    const result = await toggleEventJoinAction("event-1", null);
    expect(result).toEqual({ success: true, data: { status: "waitlisted" } });
  });

  it("leaves when currently attending", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleEventJoinAction("event-1", "joined");
    expect(mockLeaveEvent).toHaveBeenCalledWith(expect.anything(), "user-1", "event-1");
    expect(result).toEqual({ success: true, data: { status: null } });
  });

  it("leaves when a request is still pending", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleEventJoinAction("event-1", "pending_approval");
    expect(mockLeaveEvent).toHaveBeenCalledWith(expect.anything(), "user-1", "event-1");
    expect(result).toEqual({ success: true, data: { status: null } });
  });
});
