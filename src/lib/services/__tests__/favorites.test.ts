import { addFavorite, removeFavorite, listFavoriteVenueIds, isFavorite } from "@/lib/services/favorites";
import { createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";

describe("favorites service", () => {
  it("lists a user's favorite venue ids", async () => {
    const supabase = createMockSupabase({
      data: [{ venue_id: "venue-1" }, { venue_id: "venue-2" }],
      error: null,
    });
    const ids = await listFavoriteVenueIds(supabase, "user-1");
    expect(ids).toEqual(["venue-1", "venue-2"]);
  });

  it("reports isFavorite true when a row exists", async () => {
    const supabase = createMockSupabase({ data: { venue_id: "venue-1" }, error: null });
    await expect(isFavorite(supabase, "user-1", "venue-1")).resolves.toBe(true);
  });

  it("reports isFavorite false when no row exists", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(isFavorite(supabase, "user-1", "venue-1")).resolves.toBe(false);
  });

  it("addFavorite succeeds on a fresh favorite", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(addFavorite(supabase, "user-1", "venue-1")).resolves.toBeUndefined();
  });

  // The composite primary key on (user_id, venue_id) is what actually
  // prevents duplicates — this proves the service layer treats that
  // constraint violation as a successful no-op rather than surfacing an
  // error to a user who just double-clicked the heart icon.
  it("addFavorite treats a duplicate (unique_violation) as a harmless no-op", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23505") });
    await expect(addFavorite(supabase, "user-1", "venue-1")).resolves.toBeUndefined();
  });

  it("addFavorite still throws on a genuine, non-duplicate error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "permission denied") });
    await expect(addFavorite(supabase, "user-1", "venue-1")).rejects.toBeTruthy();
  });

  it("removeFavorite succeeds whether or not the favorite existed", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(removeFavorite(supabase, "user-1", "venue-1")).resolves.toBeUndefined();
  });

  it("removeFavorite throws on a genuine error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "permission denied") });
    await expect(removeFavorite(supabase, "user-1", "venue-1")).rejects.toBeTruthy();
  });
});
