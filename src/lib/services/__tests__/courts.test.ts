import { listCourtsByVenue, createCourt, updateCourt, setCourtStatus } from "@/lib/services/courts";
import { createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { Court } from "@/lib/supabase/types";

const court: Court = {
  id: "court-1",
  venue_id: "venue-1",
  name: "Court 1",
  description: null,
  surface_type: "Cushioned Acrylic",
  indoor_outdoor: "outdoor",
  capacity: 4,
  hourly_price: 500,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("courts service", () => {
  it("lists all of a venue's courts regardless of status (owner view)", async () => {
    const supabase = createMockSupabase({ data: [court, { ...court, id: "court-2", status: "inactive" }], error: null });
    const courts = await listCourtsByVenue(supabase, "venue-1");
    expect(courts).toHaveLength(2);
  });

  it("creates a court scoped to the given venue", async () => {
    const supabase = createMockSupabase({ data: court, error: null });
    const result = await createCourt(supabase, "venue-1", {
      name: "Court 1",
      surfaceType: "Cushioned Acrylic",
      indoorOutdoor: "outdoor",
      capacity: 4,
      hourlyPrice: 500,
    });
    expect(result).toEqual(court);
  });

  // Ownership isn't checked here at all — the courts insert RLS policy
  // requires venue_id to belong to auth.uid(). A mismatched venue simply
  // fails at the database layer and this rejects, same as any other error.
  it("propagates an RLS rejection when the venue isn't owned by the caller", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "row-level security") });
    await expect(
      createCourt(supabase, "someone-elses-venue", {
        name: "Court 1",
        indoorOutdoor: "outdoor",
        hourlyPrice: 500,
      })
    ).rejects.toBeTruthy();
  });

  it("updates a court's fields including status", async () => {
    const updated = { ...court, hourly_price: 600, status: "maintenance" as const };
    const supabase = createMockSupabase({ data: updated, error: null });
    const result = await updateCourt(supabase, "court-1", {
      name: "Court 1",
      indoorOutdoor: "outdoor",
      hourlyPrice: 600,
      status: "maintenance",
    });
    expect(result.hourly_price).toBe(600);
    expect(result.status).toBe("maintenance");
  });

  it("sets a court's status via the deactivate/activate convenience wrapper", async () => {
    const supabase = createMockSupabase({ data: { ...court, status: "inactive" }, error: null });
    const result = await setCourtStatus(supabase, "court-1", "inactive");
    expect(result.status).toBe("inactive");
  });
});
