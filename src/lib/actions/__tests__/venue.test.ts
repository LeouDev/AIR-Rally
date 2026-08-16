/**
 * @jest-environment node
 */
import { createVenueDraftAction, updateVenueAction, deleteVenueAction, setVenueStatusAction, setVenueAmenitiesAction, setOperatingHoursAction } from "../venue";
import { getServerClient } from "../auth";
import { createDraftVenue, updateVenue, deleteVenue, setVenueStatus, setOperatingHours } from "../../services/venues";
import { setVenueAmenities } from "../../services/amenities";
import type { CreateVenueDraftValues } from "../../validations/venue";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/venues", () => ({
  createDraftVenue: jest.fn(),
  updateVenue: jest.fn(),
  deleteVenue: jest.fn(),
  setVenueStatus: jest.fn(),
  setOperatingHours: jest.fn(),
}));
jest.mock("../../services/amenities", () => ({ setVenueAmenities: jest.fn() }));
// Geocoding is a live network call in real code — mocked here so these
// tests never hit the actual OSM Nominatim API. Resolves null (its own
// documented "couldn't geocode" outcome) rather than a fake LatLng, since
// nothing in this file asserts on the coordinates it's called with.
jest.mock("../../services/geocoding", () => ({ geocodeAddress: jest.fn().mockResolvedValue(null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateDraftVenue = createDraftVenue as jest.MockedFunction<typeof createDraftVenue>;
const mockUpdateVenue = updateVenue as jest.MockedFunction<typeof updateVenue>;
const mockDeleteVenue = deleteVenue as jest.MockedFunction<typeof deleteVenue>;
const mockSetVenueStatus = setVenueStatus as jest.MockedFunction<typeof setVenueStatus>;
const mockSetVenueAmenities = setVenueAmenities as jest.MockedFunction<typeof setVenueAmenities>;
const mockSetOperatingHours = setOperatingHours as jest.MockedFunction<typeof setOperatingHours>;

function fakeClient(user: { id: string } | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  } as never;
}

const validDraft: CreateVenueDraftValues = {
  name: "Banilad Pickle Club",
  description: "A great place to play pickleball with friends and family.",
  address: "123 Test St",
  city: "Cebu City",
  stateProvince: "Cebu",
  country: "Philippines",
  phone: "+639171234567",
  email: "owner@example.com",
  website: "",
  indoorOutdoor: "outdoor",
  numberOfCourts: 4,
};

describe("createVenueDraftAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockCreateDraftVenue.mockReset();
  });

  it("rejects invalid input before ever contacting Supabase", async () => {
    const result = await createVenueDraftAction({ ...validDraft, name: "" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createVenueDraftAction(validDraft);
    expect(result).toEqual({ success: false, error: "Sign in to list your court." });
    expect(mockCreateDraftVenue).not.toHaveBeenCalled();
  });

  // The whole point of deriving ownership from the session rather than
  // trusting a client-supplied field: createVenueDraftSchema has no
  // owner/ownerId field at all, so there is nothing in `values` an
  // attacker could set to claim a venue on someone else's behalf — the
  // owner id always comes from the authenticated session.
  it("creates the draft under the authenticated user's own id, never a client-supplied one", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateDraftVenue.mockResolvedValue({ id: "venue-1", name: validDraft.name } as never);

    const result = await createVenueDraftAction(validDraft);

    expect(result.success).toBe(true);
    expect(mockCreateDraftVenue).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ name: validDraft.name }),
      null
    );
  });

  // Phase 6: venue creation is no longer preceded by a self-promoting
  // RPC call — venues' own INSERT RLS policy (role in
  // ('venue_owner','admin')) is the only gate, and the only way to reach
  // 'venue_owner' is an admin approving an owner_applications row (see
  // lib/actions/ownerApplications.ts). A still-'player' account's
  // createDraftVenue() call is expected to fail RLS on the database side
  // (see the "42501" friendly-error mapping in lib/errors.ts) — this
  // action no longer has any role-granting step of its own to test.
  it("surfaces an RLS insufficient-privilege error with a friendly, owner-approval-aware message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateDraftVenue.mockRejectedValue({ code: "42501", message: "new row violates row-level security policy" });

    const result = await createVenueDraftAction(validDraft);

    expect(result).toEqual({ success: false, error: "You need an approved owner account to do that." });
  });
});

describe("updateVenueAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockUpdateVenue.mockReset();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await updateVenueAction("venue-1", validDraft);
    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect(mockUpdateVenue).not.toHaveBeenCalled();
  });

  // No app-level "is this my venue?" check happens here by design — RLS
  // is the actual enforcement (see the doc comment on updateVenueAction
  // itself). This test only proves the action reaches the service layer
  // with the given venueId; ownership enforcement is covered by the RLS
  // policies, not by this unit test.
  it("passes the venueId through to the service layer untouched", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockUpdateVenue.mockResolvedValue({ id: "venue-1", name: validDraft.name } as never);

    await updateVenueAction("venue-1", validDraft);

    expect(mockUpdateVenue).toHaveBeenCalledWith(
      expect.anything(),
      "venue-1",
      expect.objectContaining({ name: validDraft.name }),
      null
    );
  });

  it("maps a Postgres error to a friendly message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockUpdateVenue.mockRejectedValue(Object.assign(new Error("x"), { code: "23514" }));

    const result = await updateVenueAction("venue-1", validDraft);

    expect(result).toEqual({
      success: false,
      error: "We couldn't save that — please check the form and try again.",
    });
  });
});

describe("deleteVenueAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockDeleteVenue.mockReset();
  });

  it("rejects a malformed venue id before ever contacting Supabase", async () => {
    const result = await deleteVenueAction("not-a-uuid");
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await deleteVenueAction("223e4567-e89b-12d3-a456-426614174000");
    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect(mockDeleteVenue).not.toHaveBeenCalled();
  });

  it("deletes the venue by id, relying on RLS to allow only the owner's own draft venues", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockDeleteVenue.mockResolvedValue(undefined);

    const result = await deleteVenueAction("223e4567-e89b-12d3-a456-426614174000");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockDeleteVenue).toHaveBeenCalledWith(expect.anything(), "223e4567-e89b-12d3-a456-426614174000");
  });

  // The venues DELETE RLS policy only matches owner_id=auth.uid() AND
  // status='draft' — an active/pending/suspended venue (or someone else's)
  // matches zero rows, which deleteVenue()'s .single() turns into a
  // thrown "no rows" error. This proves that surfaces as a specific,
  // honest message rather than a generic one or a silent success.
  it("surfaces a specific message when RLS blocks the delete (non-draft or not-owned venue)", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockDeleteVenue.mockRejectedValue(Object.assign(new Error("no rows"), { code: "PGRST116" }));

    const result = await deleteVenueAction("223e4567-e89b-12d3-a456-426614174000");

    expect(result).toEqual({
      success: false,
      error: "Only draft venues can be deleted — active venues can't be removed this way.",
    });
  });
});

describe("setVenueStatusAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockSetVenueStatus.mockReset();
  });

  it("rejects an invalid status value before ever contacting Supabase", async () => {
    const result = await setVenueStatusAction("223e4567-e89b-12d3-a456-426614174000", "active" as never);
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await setVenueStatusAction("venue-1", "archived");
    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect(mockSetVenueStatus).not.toHaveBeenCalled();
  });

  it("archives a venue", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSetVenueStatus.mockResolvedValue({ id: "venue-1", status: "archived" } as never);

    const result = await setVenueStatusAction("venue-1", "archived");

    expect(result.success).toBe(true);
    expect(mockSetVenueStatus).toHaveBeenCalledWith(expect.anything(), "venue-1", "archived");
  });

  it("resubmits an archived venue for review", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSetVenueStatus.mockResolvedValue({ id: "venue-1", status: "pending_review" } as never);

    const result = await setVenueStatusAction("venue-1", "pending_review");

    expect(result.success).toBe(true);
    expect(mockSetVenueStatus).toHaveBeenCalledWith(expect.anything(), "venue-1", "pending_review");
  });
});

describe("setVenueAmenitiesAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockSetVenueAmenities.mockReset();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await setVenueAmenitiesAction("venue-1", { amenityIds: ["a1"] });
    expect(result.success).toBe(false);
    expect(mockSetVenueAmenities).not.toHaveBeenCalled();
  });

  it("replaces a venue's amenities for the authenticated owner", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSetVenueAmenities.mockResolvedValue(undefined);

    const result = await setVenueAmenitiesAction("venue-1", { amenityIds: ["a1", "a2"] });

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSetVenueAmenities).toHaveBeenCalledWith(expect.anything(), "venue-1", ["a1", "a2"]);
  });
});

describe("setOperatingHoursAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockSetOperatingHours.mockReset();
  });

  it("rejects an invalid time format before ever contacting Supabase", async () => {
    const result = await setOperatingHoursAction("venue-1", { windows: [{ dayOfWeek: 1, startTime: "8am", endTime: "20:00" }] as never });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await setOperatingHoursAction("venue-1", { windows: [] });
    expect(result.success).toBe(false);
    expect(mockSetOperatingHours).not.toHaveBeenCalled();
  });

  it("replaces a venue's operating hours for the authenticated owner", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSetOperatingHours.mockResolvedValue(undefined);

    const windows = [{ dayOfWeek: 1, startTime: "08:00", endTime: "20:00" }];
    const result = await setOperatingHoursAction("venue-1", { windows });

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSetOperatingHours).toHaveBeenCalledWith(expect.anything(), "venue-1", { windows });
  });
});
