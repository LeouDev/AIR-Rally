/**
 * @jest-environment node
 */
import { setVenueStatusAdminAction } from "../adminVenues";
import { getServerClient } from "../auth";
import { setVenueStatusAsAdmin } from "../../services/venues";
import type { Venue } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/venues", () => ({ setVenueStatusAsAdmin: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockSetVenueStatusAsAdmin = setVenueStatusAsAdmin as jest.MockedFunction<typeof setVenueStatusAsAdmin>;

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

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockSetVenueStatusAsAdmin.mockReset();
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

  it("updates the venue's status for an admin session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockSetVenueStatusAsAdmin.mockResolvedValue(VENUE_ROW);

    const result = await setVenueStatusAdminAction("venue-1", "active");

    expect(result).toEqual({ success: true, data: VENUE_ROW });
    expect(mockSetVenueStatusAsAdmin).toHaveBeenCalledWith(expect.anything(), "venue-1", "active");
  });

  it("falls back to the generic friendly-error mapper when the service throws", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockSetVenueStatusAsAdmin.mockRejectedValue(new Error("connection reset"));

    const result = await setVenueStatusAdminAction("venue-1", "suspended");

    expect(result).toEqual({ success: false, error: "We couldn't update that venue." });
  });
});
