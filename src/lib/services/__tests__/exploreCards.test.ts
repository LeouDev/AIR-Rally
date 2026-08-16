/**
 * @jest-environment node
 */
import { toVenueCardData } from "../exploreCards";
import { createTableMockSupabase } from "../../test-helpers/mockSupabase";
import type { VenueMarketplaceRow } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function buildSupabase(tables: Parameters<typeof createTableMockSupabase>[0]) {
  const base = createTableMockSupabase(tables);
  return {
    ...base,
    storage: {
      from: jest.fn(() => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      })),
    },
  } as unknown as SupabaseClient<Database>;
}

const venueRow: VenueMarketplaceRow = {
  id: "venue-1",
  name: "Test Pickle Club",
  description: null,
  address: null,
  city: "Cebu City",
  state_province: null,
  country: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  website: null,
  indoor_outdoor: "outdoor",
  number_of_courts: 2,
  average_rating: 4.5,
  review_count: 10,
  created_at: "2026-01-01T00:00:00Z",
  timezone: "UTC",
  starting_price: 500,
  active_court_count: 2,
  cover_image_path: "venue-1/cover.jpg",
};

const courts = [
  { id: "court-1", name: "Court A", venue_id: "venue-1", surface_type: "Concrete" },
  { id: "court-2", name: "Court B", venue_id: "venue-1", surface_type: null },
];

const courtImages = [{ court_id: "court-1", storage_path: "venue-1/courts/court-1/a.jpg", sort_order: 0 }];

const operatingHoursRows = [
  { id: "h-0", venue_id: "venue-1", day_of_week: 0, start_time: "00:00", end_time: "23:59", created_at: "", updated_at: "" },
];

describe("toVenueCardData", () => {
  it("returns [] without querying anything when there are no venues", async () => {
    const supabase = buildSupabase({});
    const result = await toVenueCardData(supabase, []);
    expect(result).toEqual([]);
  });

  it("batches courts/court_images/operating_hours across the whole page, not per venue", async () => {
    const supabase = buildSupabase({
      courts: { data: courts, error: null },
      court_images: { data: courtImages, error: null },
      venue_operating_hours: { data: operatingHoursRows, error: null },
    });
    const fromSpy = supabase.from as unknown as jest.Mock;

    await toVenueCardData(supabase, [venueRow]);

    const calledTables = fromSpy.mock.calls.map(([table]: [string]) => table);
    expect(calledTables).toEqual(["courts", "court_images", "venue_operating_hours"]);

    const courtsCallIndex = calledTables.indexOf("courts");
    const courtsBuilder = fromSpy.mock.results[courtsCallIndex].value as { eq: jest.Mock; in: jest.Mock };
    expect(courtsBuilder.eq).toHaveBeenCalledWith("status", "active");
    expect(courtsBuilder.in).toHaveBeenCalledWith("venue_id", ["venue-1"]);

    const imagesCallIndex = calledTables.indexOf("court_images");
    const imagesBuilder = fromSpy.mock.results[imagesCallIndex].value as { in: jest.Mock };
    expect(imagesBuilder.in).toHaveBeenCalledWith("court_id", ["court-1", "court-2"]);
  });

  it("maps a venue row into a full card: count, cover photo, per-court thumbnails (with a null fallback), and an open-status object", async () => {
    const supabase = buildSupabase({
      courts: { data: courts, error: null },
      court_images: { data: courtImages, error: null },
      venue_operating_hours: { data: operatingHoursRows, error: null },
    });

    const [card] = await toVenueCardData(supabase, [venueRow]);

    expect(card).toMatchObject({
      id: "venue-1",
      name: "Test Pickle Club",
      city: "Cebu City",
      indoorOutdoor: "outdoor",
      averageRating: 4.5,
      reviewCount: 10,
      startingPrice: 500,
      activeCourtCount: 2,
      coverImageUrl: "https://cdn.test/venue-1/cover.jpg",
    });
    expect(card.courtThumbnails).toEqual([
      { id: "court-1", imageUrl: "https://cdn.test/venue-1/courts/court-1/a.jpg", surfaceType: "Concrete" },
      { id: "court-2", imageUrl: null, surfaceType: null },
    ]);
    expect(card.openStatus).toEqual(expect.objectContaining({ isOpenNow: expect.any(Boolean), label: expect.any(String) }));
  });

  it("never puts owner-only data (customer names, booking ids, block reasons) on a card", async () => {
    const supabase = buildSupabase({
      courts: { data: courts, error: null },
      court_images: { data: courtImages, error: null },
      venue_operating_hours: { data: operatingHoursRows, error: null },
    });

    const [card] = await toVenueCardData(supabase, [venueRow]);
    const serialized = JSON.stringify(card);
    expect(serialized).not.toMatch(/customerName|customer_name|bookingId|booking_id|blockReason|block_reason/i);
  });

  it("gives a venue with no active courts an empty thumbnail list rather than erroring", async () => {
    const supabase = buildSupabase({
      courts: { data: [], error: null },
      venue_operating_hours: { data: operatingHoursRows, error: null },
    });

    const [card] = await toVenueCardData(supabase, [venueRow]);
    expect(card.courtThumbnails).toEqual([]);
  });
});
