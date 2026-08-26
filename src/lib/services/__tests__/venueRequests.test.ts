import { createVenueRequest, getPublicVenueRequestSummary, DuplicateVenueRequestError } from "@/lib/services/venueRequests";
import { createQueryBuilder, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The two pieces of real logic in this service — everything else is a thin
 * RPC pass-through already exercised by the migration's own rehearsal
 * (23 checks against a live database in supabase/migrations/20260810000106).
 */
describe("venueRequests service", () => {
  it("createVenueRequest maps a unique-constraint hit to a friendly, named error", async () => {
    const supabase = {
      from: jest.fn(() => createQueryBuilder({ data: null, error: postgrestError("23505") })),
    } as unknown as SupabaseClient<Database>;

    await expect(
      createVenueRequest(supabase, "user-1", { placeName: "Court X" })
    ).rejects.toBeInstanceOf(DuplicateVenueRequestError);
  });

  it("createVenueRequest still throws a genuine error as-is, not as DuplicateVenueRequestError", async () => {
    const supabase = {
      from: jest.fn(() => createQueryBuilder({ data: null, error: postgrestError("42501", "denied") })),
    } as unknown as SupabaseClient<Database>;

    await expect(
      createVenueRequest(supabase, "user-1", { placeName: "Court X" })
    ).rejects.not.toBeInstanceOf(DuplicateVenueRequestError);
  });

  /**
   * public_venue_request_summary() raises no_data_found for an unknown id
   * (see the migration) — the SERVICE turns that into `null` so the PAGE can
   * call notFound() rather than rendering a raw Postgres error message to a
   * venue manager with no account and no context for what it means.
   */
  it("getPublicVenueRequestSummary returns null for a request that does not exist", async () => {
    const supabase = {
      rpc: jest.fn(() => ({
        single: () =>
          Promise.resolve({ data: null, error: { message: "No such request.", code: "PGRST116" } }),
      })),
    } as unknown as SupabaseClient<Database>;

    await expect(getPublicVenueRequestSummary(supabase, "00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("getPublicVenueRequestSummary still throws a genuine error rather than swallowing it", async () => {
    const supabase = {
      rpc: jest.fn(() => ({
        single: () => Promise.resolve({ data: null, error: postgrestError("08006", "connection lost") }),
      })),
    } as unknown as SupabaseClient<Database>;

    await expect(getPublicVenueRequestSummary(supabase, "00000000-0000-0000-0000-000000000000")).rejects.toBeTruthy();
  });
});
