/**
 * @jest-environment node
 */
import { setVenueStatusAdminAction } from "../adminVenues";
import { getServerClient } from "../auth";
import { setVenueStatusAsAdmin } from "../../services/venues";
import { getVenueReadiness } from "../../services/venueReadiness";
import type { Venue } from "../../supabase/types";
import type { VenueReadiness } from "../../services/venueReadiness";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/venues", () => ({ setVenueStatusAsAdmin: jest.fn() }));
jest.mock("../../services/venueReadiness", () => ({ getVenueReadiness: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockSetVenueStatusAsAdmin = setVenueStatusAsAdmin as jest.MockedFunction<typeof setVenueStatusAsAdmin>;
const mockGetVenueReadiness = getVenueReadiness as jest.MockedFunction<typeof getVenueReadiness>;

/** Matches refund.test.ts's own fakeClient — exercises the real requireAdmin() against a stubbed profiles lookup, rather than mocking requireAdmin itself. */
function fakeAdminClient(user: { id: string } | null, role: string | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: "not found" } }) })) })),
    })),
  } as never;
}

const VENUE_ROW = { id: "venue-1", status: "active" } as Venue;

/** A readiness report where every item — including platform_approval — is complete, the "fully ready" case. */
const FULLY_READY: VenueReadiness = {
  venueId: "venue-1",
  isReady: true,
  items: [
    { key: "business_info", label: "Venue business information", status: "complete", detail: "", actionHref: null },
    { key: "location", label: "Venue address", status: "complete", detail: "", actionHref: null },
    { key: "courts", label: "Active courts", status: "complete", detail: "", actionHref: null },
    { key: "court_pricing", label: "Court pricing", status: "complete", detail: "", actionHref: null },
    { key: "operating_hours", label: "Operating hours", status: "complete", detail: "", actionHref: null },
    { key: "platform_approval", label: "Platform approval", status: "action_required", detail: "", actionHref: null },
    { key: "payout_destination", label: "Payout details", status: "complete", detail: "", actionHref: null },
  ],
};

/** Same as FULLY_READY, but operating_hours was never configured — the exact production bug this gate exists to catch. */
const MISSING_HOURS: VenueReadiness = {
  ...FULLY_READY,
  isReady: false,
  items: FULLY_READY.items.map((item) =>
    item.key === "operating_hours" ? { ...item, status: "action_required" as const, detail: "Set at least one open day/time window." } : item
  ),
};

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockSetVenueStatusAsAdmin.mockReset();
  mockGetVenueReadiness.mockReset();
});

describe("setVenueStatusAdminAction", () => {
  it("rejects a non-admin session before ever calling setVenueStatusAsAdmin", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "user-1" }, "venue_owner") });
    const result = await setVenueStatusAdminAction("venue-1", "active");
    expect(result).toEqual({ success: false, error: "This area is admin-only." });
    expect(mockSetVenueStatusAsAdmin).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient(null, null) });
    const result = await setVenueStatusAdminAction("venue-1", "active");
    expect(result.success).toBe(false);
    expect(mockSetVenueStatusAsAdmin).not.toHaveBeenCalled();
  });

  it("activates a fully-ready venue for an admin session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockGetVenueReadiness.mockResolvedValue(FULLY_READY);
    mockSetVenueStatusAsAdmin.mockResolvedValue(VENUE_ROW);

    const result = await setVenueStatusAdminAction("venue-1", "active");

    expect(result).toEqual({ success: true, data: VENUE_ROW });
    expect(mockSetVenueStatusAsAdmin).toHaveBeenCalledWith(expect.anything(), "venue-1", "active");
  });

  it("ignores platform_approval's own status when deciding readiness to activate", async () => {
    // FULLY_READY's platform_approval item is deliberately "action_required"
    // (the venue isn't active yet, which is the whole point of this call) —
    // activation must still proceed, or a venue could never be activated at all.
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockGetVenueReadiness.mockResolvedValue(FULLY_READY);
    mockSetVenueStatusAsAdmin.mockResolvedValue(VENUE_ROW);

    const result = await setVenueStatusAdminAction("venue-1", "active");

    expect(result.success).toBe(true);
  });

  it("refuses to activate a venue with no operating hours configured, and never calls setVenueStatusAsAdmin", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockGetVenueReadiness.mockResolvedValue(MISSING_HOURS);

    const result = await setVenueStatusAdminAction("venue-1", "active");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("operating hours");
    }
    expect(mockSetVenueStatusAsAdmin).not.toHaveBeenCalled();
  });

  it("does not check readiness at all when suspending a venue", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockSetVenueStatusAsAdmin.mockResolvedValue({ ...VENUE_ROW, status: "suspended" } as Venue);

    const result = await setVenueStatusAdminAction("venue-1", "suspended");

    expect(result.success).toBe(true);
    expect(mockGetVenueReadiness).not.toHaveBeenCalled();
    expect(mockSetVenueStatusAsAdmin).toHaveBeenCalledWith(expect.anything(), "venue-1", "suspended");
  });

  it("falls back to the generic friendly-error mapper when the service throws", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockSetVenueStatusAsAdmin.mockRejectedValue(new Error("connection reset"));

    const result = await setVenueStatusAdminAction("venue-1", "suspended");

    expect(result).toEqual({ success: false, error: "We couldn't update that venue." });
  });
});
