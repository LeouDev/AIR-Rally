/**
 * @jest-environment node
 */
import { createCourtAction, updateCourtAction, setCourtStatusAction } from "../court";
import { getServerClient } from "../auth";
import { createCourt, updateCourt, setCourtStatus } from "../../services/courts";
import type { CreateCourtValues } from "../../validations/court";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/courts", () => ({
  createCourt: jest.fn(),
  updateCourt: jest.fn(),
  setCourtStatus: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateCourt = createCourt as jest.MockedFunction<typeof createCourt>;
const mockUpdateCourt = updateCourt as jest.MockedFunction<typeof updateCourt>;
const mockSetCourtStatus = setCourtStatus as jest.MockedFunction<typeof setCourtStatus>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const validCourt: CreateCourtValues = {
  name: "Court 1",
  description: "",
  surfaceType: "Cushioned Acrylic",
  indoorOutdoor: "outdoor",
  capacity: 4,
  hourlyPrice: 500,
};

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreateCourt.mockReset();
  mockUpdateCourt.mockReset();
  mockSetCourtStatus.mockReset();
});

describe("createCourtAction", () => {
  it("rejects invalid input before contacting Supabase", async () => {
    const result = await createCourtAction("venue-1", { ...validCourt, name: "" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createCourtAction("venue-1", validCourt);
    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect(mockCreateCourt).not.toHaveBeenCalled();
  });

  // Ownership is enforced by the courts insert RLS policy (the venue must
  // belong to auth.uid()), not by this action — it just forwards venueId.
  // A court insert for a venue the caller doesn't own fails at the
  // database layer, which surfaces here as a normal thrown error.
  it("forwards venueId to the service layer for RLS to enforce ownership", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateCourt.mockResolvedValue({ id: "court-1", ...validCourt, status: "active" } as never);

    await createCourtAction("venue-1", validCourt);

    expect(mockCreateCourt).toHaveBeenCalledWith(expect.anything(), "venue-1", expect.objectContaining({
      name: "Court 1",
    }));
  });

  it("maps an RLS/permission rejection to a friendly message instead of leaking it", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateCourt.mockRejectedValue(new Error("new row violates row-level security policy"));

    const result = await createCourtAction("venue-1", validCourt);

    expect(result).toEqual({ success: false, error: "We couldn't add that court." });
  });
});

describe("updateCourtAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await updateCourtAction("venue-1", "court-1", { ...validCourt, status: "active" });
    expect(result.success).toBe(false);
    expect(mockUpdateCourt).not.toHaveBeenCalled();
  });

  it("updates an existing court for the authenticated owner", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockUpdateCourt.mockResolvedValue({ id: "court-1", ...validCourt, status: "inactive" } as never);

    const result = await updateCourtAction("venue-1", "court-1", { ...validCourt, status: "inactive" });

    expect(result.success).toBe(true);
    expect(mockUpdateCourt).toHaveBeenCalledWith(expect.anything(), "court-1", expect.objectContaining({
      status: "inactive",
    }));
  });
});

describe("setCourtStatusAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await setCourtStatusAction("venue-1", "court-1", "inactive");
    expect(result.success).toBe(false);
    expect(mockSetCourtStatus).not.toHaveBeenCalled();
  });

  it("deactivates a court for the authenticated owner", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSetCourtStatus.mockResolvedValue({ id: "court-1", status: "inactive" } as never);

    const result = await setCourtStatusAction("venue-1", "court-1", "inactive");

    expect(result.success).toBe(true);
    expect(mockSetCourtStatus).toHaveBeenCalledWith(expect.anything(), "court-1", "inactive");
  });
});
