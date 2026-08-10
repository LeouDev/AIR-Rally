import { listAmenities, listAmenityIdsForVenue, setVenueAmenities } from "@/lib/services/amenities";
import { createMockSupabase, createTableMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { Amenity } from "@/lib/supabase/types";

const amenities: Amenity[] = [
  { id: "a1", name: "Lockers", icon: "lock", created_at: "2026-01-01T00:00:00Z" },
  { id: "a2", name: "Showers", icon: "shower-head", created_at: "2026-01-01T00:00:00Z" },
];

describe("amenities service", () => {
  it("lists all amenities alphabetically (delegated to the DB order clause)", async () => {
    const supabase = createMockSupabase({ data: amenities, error: null });
    await expect(listAmenities(supabase)).resolves.toEqual(amenities);
  });

  it("lists the amenity ids linked to a venue", async () => {
    const supabase = createMockSupabase({
      data: [{ amenity_id: "a1" }, { amenity_id: "a2" }],
      error: null,
    });
    await expect(listAmenityIdsForVenue(supabase, "venue-1")).resolves.toEqual(["a1", "a2"]);
  });

  it("replaces a venue's amenities with a delete-then-insert of the new set", async () => {
    const deleteBuilder = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    const insertBuilder = jest.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: jest.fn(() => ({
        delete: jest.fn(() => deleteBuilder),
        insert: insertBuilder,
      })),
    } as never;

    await setVenueAmenities(supabase, "venue-1", ["a1", "a2"]);

    expect(deleteBuilder.eq).toHaveBeenCalledWith("venue_id", "venue-1");
    expect(insertBuilder).toHaveBeenCalledWith([
      { venue_id: "venue-1", amenity_id: "a1" },
      { venue_id: "venue-1", amenity_id: "a2" },
    ]);
  });

  it("skips the insert entirely when clearing all amenities", async () => {
    const deleteBuilder = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    const insertBuilder = jest.fn();
    const supabase = {
      from: jest.fn(() => ({
        delete: jest.fn(() => deleteBuilder),
        insert: insertBuilder,
      })),
    } as never;

    await setVenueAmenities(supabase, "venue-1", []);

    expect(insertBuilder).not.toHaveBeenCalled();
  });

  it("throws if the delete step fails, without calling insert", async () => {
    const supabase = createTableMockSupabase({
      venue_amenities: { data: null, error: postgrestError("42501", "denied") },
    });
    await expect(setVenueAmenities(supabase, "venue-1", ["a1"])).rejects.toBeTruthy();
  });
});
