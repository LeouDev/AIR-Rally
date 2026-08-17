import { getVenueReadiness } from "../venueReadiness";
import { createTableMockSupabase } from "@/lib/test-helpers/mockSupabase";
import type { Venue, Court } from "@/lib/supabase/types";

const READY_VENUE: Venue = {
  id: "venue-1",
  owner_id: "owner-1",
  name: "Rizal Pickleball Club",
  description: "A great club with 4 courts.",
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
  number_of_courts: 1,
  average_rating: 0,
  review_count: 0,
  status: "active",
  timezone: "Asia/Manila",
  paymongo_account_id: null,
  paymongo_activation_status: "unlinked",
  paymongo_onboarding_started_at: null,
  paymongo_activated_at: null,
  paymongo_declined_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const ACTIVE_COURT: Court = {
  id: "court-1",
  venue_id: "venue-1",
  name: "Court 1",
  description: null,
  surface_type: null,
  indoor_outdoor: "outdoor",
  capacity: null,
  hourly_price: 500,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("getVenueReadiness", () => {
  // PayMongo is the only payment provider since the Stripe path was
  // removed, so a venue that hasn't connected it cannot be paid — and must
  // not be reported as ready. This used to depend on ACTIVE_PAYMENT_PROVIDER
  // being set; an environment that never set it would have called this
  // venue ready while it had no way to receive money.
  it("is NOT ready when PayMongo has never been connected", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: READY_VENUE, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 2 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.isReady).toBe(false);
    expect(result.items.find((i) => i.key === "paymongo_onboarding")?.status).toBe("action_required");
  });

  it("reports fully ready once PayMongo is activated and everything else is done", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: { ...READY_VENUE, paymongo_activation_status: "activated" }, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 2 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.isReady).toBe(true);
    expect(result.items.find((i) => i.key === "paymongo_onboarding")?.status).toBe("complete");
  });

  it("flags missing operating hours as action_required and marks the venue not ready", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: READY_VENUE, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 0 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.isReady).toBe(false);
    expect(result.items.find((i) => i.key === "operating_hours")?.status).toBe("action_required");
  });

  it("flags a venue with no active courts, and pricing as blocked on that", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: READY_VENUE, error: null },
      courts: { data: [{ ...ACTIVE_COURT, status: "inactive" }], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.isReady).toBe(false);
    expect(result.items.find((i) => i.key === "courts")?.status).toBe("action_required");
    expect(result.items.find((i) => i.key === "court_pricing")?.status).toBe("action_required");
  });

  it("flags a ₱0 court price as incomplete pricing", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: READY_VENUE, error: null },
      courts: { data: [{ ...ACTIVE_COURT, hourly_price: 0 }], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.items.find((i) => i.key === "court_pricing")?.status).toBe("action_required");
  });

  it("flags a draft venue as not yet platform-approved", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: { ...READY_VENUE, status: "draft" }, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.items.find((i) => i.key === "platform_approval")?.status).toBe("action_required");
    expect(result.isReady).toBe(false);
  });

  it("requires PayMongo activation only when PayMongo is the active provider", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    const supabase = createTableMockSupabase({
      venues: { data: READY_VENUE, error: null }, // paymongo_activation_status: "unlinked"
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.items.find((i) => i.key === "paymongo_onboarding")?.status).toBe("action_required");
    expect(result.isReady).toBe(false);
  });

  it("is ready when PayMongo is active and the venue is fully activated", async () => {
    process.env.ACTIVE_PAYMENT_PROVIDER = "paymongo";
    const supabase = createTableMockSupabase({
      venues: { data: { ...READY_VENUE, paymongo_activation_status: "activated" }, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.items.find((i) => i.key === "paymongo_onboarding")?.status).toBe("complete");
    expect(result.isReady).toBe(true);
  });

  it("flags missing business info (blank description) as action_required", async () => {
    const supabase = createTableMockSupabase({
      venues: { data: { ...READY_VENUE, description: "" }, error: null },
      courts: { data: [ACTIVE_COURT], error: null },
      venue_operating_hours: { data: null, error: null, count: 1 },
    });

    const result = await getVenueReadiness(supabase, "venue-1");

    expect(result.items.find((i) => i.key === "business_info")?.status).toBe("action_required");
  });
});
