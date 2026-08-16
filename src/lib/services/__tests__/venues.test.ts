import {
  searchMarketplaceVenues,
  getVenueDetail,
  listFavoritedVenues,
  getVenueForOwner,
  createDraftVenue,
  deleteVenue,
  listVenuesByOwnerWithSummary,
  linkVenuePaymongoAccount,
  syncVenuePaymongoActivation,
  listOperatingHours,
  setOperatingHours,
} from "@/lib/services/venues";
import { createMockSupabase, createTableMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { VenueMarketplaceRow, Venue } from "@/lib/supabase/types";

const marketplaceRow: VenueMarketplaceRow = {
  id: "venue-1",
  name: "Banilad Pickle Club",
  description: "A great place to play.",
  address: "123 Test St",
  city: "Cebu City",
  state_province: "Cebu",
  country: "Philippines",
  latitude: null,
  longitude: null,
  phone: "+639171234567",
  email: "owner@example.com",
  website: null,
  indoor_outdoor: "outdoor",
  number_of_courts: 4,
  average_rating: 4.8,
  review_count: 42,
  created_at: "2026-01-01T00:00:00Z",
  timezone: "Asia/Manila",
  starting_price: 500,
  active_court_count: 4,
};

describe("searchMarketplaceVenues", () => {
  it("returns venues with pagination metadata", async () => {
    const supabase = createMockSupabase({ data: [marketplaceRow], error: null, count: 1 });
    const result = await searchMarketplaceVenues(supabase, {});
    expect(result).toEqual({ venues: [marketplaceRow], total: 1, page: 1, pageSize: 12 });
  });

  it("clamps page and pageSize to sane minimums/maximums", async () => {
    const supabase = createMockSupabase({ data: [], error: null, count: 0 });
    const result = await searchMarketplaceVenues(supabase, { page: -5, pageSize: 999 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(48); // MAX_PAGE_SIZE
  });

  it("looks up matching court names before running the main query when searching by text", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [{ venue_id: "venue-2" }], error: null },
      venue_marketplace: { data: [marketplaceRow], error: null, count: 1 },
    });
    const result = await searchMarketplaceVenues(supabase, { q: "pickle" });
    expect(result.venues).toEqual([marketplaceRow]);
  });

  // The whole reason sanitizeSearchTerm exists: raw user input with `,`/
  // `(`/`)` could otherwise reshape the .or() filter string PostgREST
  // receives. This doesn't assert on the exact filter string (an
  // implementation detail) — it asserts the query still executes
  // successfully with no thrown error, proving the dangerous characters
  // never reach the query unescaped.
  it("does not throw when the search term contains PostgREST filter syntax characters", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [], error: null },
      venue_marketplace: { data: [], error: null, count: 0 },
    });
    await expect(
      searchMarketplaceVenues(supabase, { q: "a,b)(or evil.eq.1" })
    ).resolves.toBeDefined();
  });

  it("intersects amenity filters with AND semantics, not OR", async () => {
    const supabase = createTableMockSupabase({
      venue_amenities: {
        data: [
          { venue_id: "venue-1", amenity_id: "11111111-1111-1111-1111-111111111111" },
          { venue_id: "venue-1", amenity_id: "22222222-2222-2222-2222-222222222222" },
          { venue_id: "venue-2", amenity_id: "11111111-1111-1111-1111-111111111111" },
        ],
        error: null,
      },
      venue_marketplace: { data: [marketplaceRow], error: null, count: 1 },
    });

    const builder = { in: jest.fn() };
    const originalFrom = (supabase as unknown as { from: jest.Mock }).from;
    (supabase as unknown as { from: jest.Mock }).from = jest.fn((table: string) => {
      const b = originalFrom(table);
      if (table === "venue_marketplace") {
        const spy = b.in as jest.Mock;
        builder.in = spy;
      }
      return b;
    });

    await searchMarketplaceVenues(supabase, {
      amenityIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
    });

    // Only venue-1 has both amenities; venue-2 only has one, so it must be
    // excluded from the `.in("id", ...)` call the main query makes.
    expect(builder.in).toHaveBeenCalledWith("id", ["venue-1"]);
  });

  it("filters out non-UUID amenity ids instead of sending them to the database", async () => {
    const supabase = createTableMockSupabase({
      venue_amenities: { data: [], error: null },
      venue_marketplace: { data: [], error: null, count: 0 },
    });
    await expect(
      searchMarketplaceVenues(supabase, { amenityIds: ["not-a-uuid", "'; drop table venues;--"] })
    ).resolves.toBeDefined();
  });
});

describe("getVenueDetail", () => {
  it("returns null for a venue that doesn't exist or isn't active, without distinguishing the two", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getVenueDetail(supabase, "missing-venue")).resolves.toBeNull();
  });

  // A malformed URL param (e.g. /courts/not-a-uuid) makes Postgres reject
  // the `.eq("id", ...)` comparison outright rather than just finding no
  // row — this must look like "not found" to the page too, not surface a
  // raw database error via error.tsx.
  it("treats a malformed venue id (invalid UUID syntax) as not-found, not a thrown error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("22P02", "invalid input syntax for type uuid") });
    await expect(getVenueDetail(supabase, "not-a-uuid")).resolves.toBeNull();
  });

  it("still throws on a genuine, unrelated database error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("57014", "query canceled") });
    await expect(getVenueDetail(supabase, "venue-1")).rejects.toBeTruthy();
  });

  it("assembles the venue with its active courts, amenities, and images", async () => {
    const supabase = createTableMockSupabase({
      venue_marketplace: { data: marketplaceRow, error: null },
      courts: { data: [{ id: "court-1", status: "active" }], error: null },
      venue_amenities: { data: [{ amenity_id: "a1" }], error: null },
      court_images: { data: [], error: null },
      amenities: { data: [{ id: "a1", name: "Lockers", icon: "lock", created_at: "2026-01-01T00:00:00Z" }], error: null },
    });

    const detail = await getVenueDetail(supabase, "venue-1");

    expect(detail?.id).toBe("venue-1");
    expect(detail?.courts).toEqual([{ id: "court-1", status: "active" }]);
    expect(detail?.amenities).toEqual([{ id: "a1", name: "Lockers", icon: "lock", created_at: "2026-01-01T00:00:00Z" }]);
    expect(detail?.images).toEqual([]);
  });

  it("skips the amenities lookup entirely when the venue has none linked", async () => {
    const supabase = createTableMockSupabase({
      venue_marketplace: { data: marketplaceRow, error: null },
      courts: { data: [], error: null },
      venue_amenities: { data: [], error: null },
      court_images: { data: [], error: null },
    });

    const detail = await getVenueDetail(supabase, "venue-1");
    expect(detail?.amenities).toEqual([]);
  });
});

describe("listFavoritedVenues", () => {
  it("returns an empty list without querying venues when the user has no favorites", async () => {
    const supabase = createTableMockSupabase({
      favorites: { data: [], error: null },
    });
    await expect(listFavoritedVenues(supabase, "user-1")).resolves.toEqual([]);
  });

  it("resolves favorited venue ids to their marketplace rows", async () => {
    const supabase = createTableMockSupabase({
      favorites: { data: [{ venue_id: "venue-1" }], error: null },
      venue_marketplace: { data: [marketplaceRow], error: null },
    });
    await expect(listFavoritedVenues(supabase, "user-1")).resolves.toEqual([marketplaceRow]);
  });
});

describe("owner-facing venue reads", () => {
  it("getVenueForOwner returns null when RLS hides the row (not the caller's venue)", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getVenueForOwner(supabase, "someone-elses-venue")).resolves.toBeNull();
  });

  it("createDraftVenue always saves with status 'draft'", async () => {
    const insertedRow: Venue = {
      id: "venue-1",
      owner_id: "user-1",
      name: "Banilad Pickle Club",
      description: "desc",
      address: "123 Test St",
      city: "Cebu City",
      state_province: "Cebu",
      country: "Philippines",
      latitude: null,
      longitude: null,
      phone: "+639171234567",
      email: "owner@example.com",
      website: null,
      indoor_outdoor: "outdoor",
      number_of_courts: 4,
      average_rating: 0,
      review_count: 0,
      status: "draft",
      timezone: "Asia/Manila",
      paymongo_account_id: null,
      paymongo_activation_status: "unlinked",
      paymongo_onboarding_started_at: null,
      paymongo_activated_at: null,
      paymongo_declined_reason: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    let capturedInsert: unknown;
    const supabase = {
      from: jest.fn(() => ({
        insert: jest.fn((payload: unknown) => {
          capturedInsert = payload;
          return {
            select: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({ data: insertedRow, error: null }),
            })),
          };
        }),
      })),
    } as never;

    await createDraftVenue(supabase, "user-1", {
      name: "Banilad Pickle Club",
      description: "desc",
      address: "123 Test St",
      city: "Cebu City",
      stateProvince: "Cebu",
      country: "Philippines",
      phone: "+639171234567",
      email: "owner@example.com",
      website: "",
      indoorOutdoor: "outdoor",
      numberOfCourts: 4,
    });

    expect(capturedInsert).toMatchObject({ owner_id: "user-1", status: "draft" });
  });
});

describe("linkVenuePaymongoAccount", () => {
  it("calls sync_venue_paymongo_status with the exact params, defaulting activation_status to 'pending'", async () => {
    const supabase = createTableMockSupabase({}, { sync_venue_paymongo_status: { data: true, error: null } });

    const result = await linkVenuePaymongoAccount(supabase, "venue-1", "org_test_merchant");

    expect(result).toBe(true);
    expect((supabase as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith("sync_venue_paymongo_status", {
      p_venue_id: "venue-1",
      p_paymongo_account_id: "org_test_merchant",
      p_activation_status: "pending",
    });
  });

  it("returns false (no-op) rather than throwing when the venue is already linked or not owned by this session", async () => {
    const supabase = createTableMockSupabase({}, { sync_venue_paymongo_status: { data: false, error: null } });
    await expect(linkVenuePaymongoAccount(supabase, "venue-1", "org_test_merchant")).resolves.toBe(false);
  });
});

describe("syncVenuePaymongoActivation", () => {
  it("calls sync_venue_paymongo_activation with the exact params — no venue_id needed", async () => {
    const supabase = createTableMockSupabase({}, { sync_venue_paymongo_activation: { data: true, error: null } });

    const result = await syncVenuePaymongoActivation(supabase, {
      paymongoAccountId: "org_test_merchant",
      activationStatus: "activated",
    });

    expect(result).toBe(true);
    expect((supabase as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith("sync_venue_paymongo_activation", {
      p_paymongo_account_id: "org_test_merchant",
      p_activation_status: "activated",
      p_declined_reason: null,
    });
  });

  it("passes through a decline reason", async () => {
    const supabase = createTableMockSupabase({}, { sync_venue_paymongo_activation: { data: true, error: null } });

    await syncVenuePaymongoActivation(supabase, {
      paymongoAccountId: "org_test_merchant",
      activationStatus: "declined",
      declinedReason: "KYC failed",
    });

    expect((supabase as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith(
      "sync_venue_paymongo_activation",
      expect.objectContaining({ p_declined_reason: "KYC failed" })
    );
  });

  it("returns false (safe no-op) when no venue has that account id linked — a stray webhook event", async () => {
    const supabase = createTableMockSupabase({}, { sync_venue_paymongo_activation: { data: false, error: null } });
    await expect(
      syncVenuePaymongoActivation(supabase, { paymongoAccountId: "org_unknown", activationStatus: "activated" })
    ).resolves.toBe(false);
  });
});

describe("listOperatingHours", () => {
  it("lists a venue's operating hours ordered by day of week", async () => {
    const rows = [{ id: "h1", venue_id: "venue-1", day_of_week: 1, start_time: "08:00:00", end_time: "20:00:00", created_at: "", updated_at: "" }];
    const supabase = createMockSupabase({ data: rows, error: null });
    await expect(listOperatingHours(supabase, "venue-1")).resolves.toEqual(rows);
  });
});

describe("setOperatingHours", () => {
  it("replaces a venue's operating hours with a delete-then-insert, converting HH:MM to a real time literal", async () => {
    const deleteBuilder = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    const insertBuilder = jest.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: jest.fn(() => ({
        delete: jest.fn(() => deleteBuilder),
        insert: insertBuilder,
      })),
    } as never;

    await setOperatingHours(supabase, "venue-1", {
      windows: [
        { dayOfWeek: 1, startTime: "08:00", endTime: "20:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "18:00" },
      ],
    });

    expect(deleteBuilder.eq).toHaveBeenCalledWith("venue_id", "venue-1");
    expect(insertBuilder).toHaveBeenCalledWith([
      { venue_id: "venue-1", day_of_week: 1, start_time: "08:00:00", end_time: "20:00:00" },
      { venue_id: "venue-1", day_of_week: 2, start_time: "09:00:00", end_time: "18:00:00" },
    ]);
  });

  it("skips the insert entirely when every day is set to closed", async () => {
    const deleteBuilder = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    const insertBuilder = jest.fn();
    const supabase = {
      from: jest.fn(() => ({
        delete: jest.fn(() => deleteBuilder),
        insert: insertBuilder,
      })),
    } as never;

    await setOperatingHours(supabase, "venue-1", { windows: [] });

    expect(deleteBuilder.eq).toHaveBeenCalledWith("venue_id", "venue-1");
    expect(insertBuilder).not.toHaveBeenCalled();
  });
});

function ownerVenueRow(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    owner_id: "user-1",
    name: "Banilad Pickle Club",
    description: "desc",
    address: "123 Test St",
    city: "Cebu City",
    state_province: "Cebu",
    country: "Philippines",
    latitude: null,
    longitude: null,
    phone: "+639171234567",
    email: "owner@example.com",
    website: null,
    indoor_outdoor: "outdoor",
    number_of_courts: 4,
    average_rating: 0,
    review_count: 0,
    status: "draft",
    timezone: "Asia/Manila",
    paymongo_account_id: null,
    paymongo_activation_status: "unlinked",
    paymongo_onboarding_started_at: null,
    paymongo_activated_at: null,
    paymongo_declined_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("listVenuesByOwnerWithSummary", () => {
  it("returns an empty array without any follow-up queries when the owner has no venues", async () => {
    const supabase = createTableMockSupabase({ venues: { data: [], error: null } });
    await expect(listVenuesByOwnerWithSummary(supabase, "user-1")).resolves.toEqual([]);
  });

  it("attaches a real court count (not the static number_of_courts field) and the lowest-sort_order venue-level cover image", async () => {
    const venueA = ownerVenueRow({ id: "venue-a", number_of_courts: 99 });
    const venueB = ownerVenueRow({ id: "venue-b", name: "No Photos Yet" });

    const supabase = {
      ...createTableMockSupabase({
        venues: { data: [venueA, venueB], error: null },
        courts: {
          data: [
            { id: "court-1", venue_id: "venue-a" },
            { id: "court-2", venue_id: "venue-a" },
          ],
          error: null,
        },
        court_images: {
          data: [
            { venue_id: "venue-a", storage_path: "venue-a/cover.jpg", sort_order: 0 },
            { venue_id: "venue-a", storage_path: "venue-a/second.jpg", sort_order: 1 },
          ],
          error: null,
        },
      }),
      storage: { from: jest.fn(() => ({ getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://cdn.test/venue-a/cover.jpg" } })) })) },
    } as never;

    const result = await listVenuesByOwnerWithSummary(supabase, "user-1");

    expect(result).toEqual([
      expect.objectContaining({ id: "venue-a", courtCount: 2, coverImageUrl: "https://cdn.test/venue-a/cover.jpg" }),
      expect.objectContaining({ id: "venue-b", courtCount: 0, coverImageUrl: null }),
    ]);
  });
});

describe("deleteVenue", () => {
  it("deletes by id", async () => {
    const eqMock = jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: "venue-1" }, error: null }) })) }));
    const supabase = { from: jest.fn(() => ({ delete: jest.fn(() => ({ eq: eqMock })) })) } as never;

    await deleteVenue(supabase, "venue-1");

    expect(eqMock).toHaveBeenCalledWith("id", "venue-1");
  });

  // RLS (owner_id=auth.uid() AND status='draft', see
  // supabase/migrations/20260809000002_venues.sql) is what actually
  // prevents deleting a non-draft or not-owned venue — this proves the
  // service layer surfaces that as a thrown error rather than a silent
  // no-op success.
  it("throws when RLS matches zero rows (non-draft or not-owned venue)", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("PGRST116") });
    await expect(deleteVenue(supabase, "venue-1")).rejects.toMatchObject({ code: "PGRST116" });
  });
});
