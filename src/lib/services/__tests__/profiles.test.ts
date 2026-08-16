import { updateProfile, updateAvatar, getProfileStats } from "@/lib/services/profiles";
import { createMockSupabase, createTableMockSupabase } from "@/lib/test-helpers/mockSupabase";

describe("profiles service", () => {
  it("never includes a role field in the update payload", async () => {
    const supabase = createMockSupabase({
      data: { id: "user-1", role: "player" },
      error: null,
    });

    await updateProfile(supabase, "user-1", {
      firstName: "Jamie",
      lastName: "Cruz",
      displayName: "Jamie C.",
      phone: "",
      avatarUrl: "",
    });

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock };
    const payload = builder.update.mock.calls[0][0];

    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("id");
  });

  it("converts blank phone/avatar back to null rather than storing empty strings", async () => {
    const supabase = createMockSupabase({ data: { id: "user-1" }, error: null });

    await updateProfile(supabase, "user-1", {
      firstName: "Jamie",
      lastName: "Cruz",
      displayName: "Jamie C.",
      phone: "",
      avatarUrl: "",
    });

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock };
    const payload = builder.update.mock.calls[0][0];

    expect(payload.phone).toBeNull();
    expect(payload.avatar_url).toBeNull();
  });

  it("updateAvatar only ever writes avatar_url, never other profile fields", async () => {
    const supabase = createMockSupabase({ data: { id: "user-1", avatar_url: "https://cdn.test/a.png" }, error: null });

    await updateAvatar(supabase, "user-1", "https://cdn.test/a.png");

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { update: jest.Mock };
    const payload = builder.update.mock.calls[0][0];

    expect(payload).toEqual({ avatar_url: "https://cdn.test/a.png" });
  });

  it("getProfileStats counts only confirmed bookings as trips, and all of the user's reviews", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: null, error: null, count: 3 },
      reviews: { data: null, error: null, count: 1 },
    });

    const stats = await getProfileStats(supabase, "user-1", "2026-01-15T00:00:00Z");

    expect(stats).toEqual({ tripCount: 3, reviewCount: 1, memberSince: "2026-01-15T00:00:00Z" });

    const fromMock = supabase.from as jest.Mock;
    const bookingsCallIndex = fromMock.mock.calls.findIndex(([table]) => table === "bookings");
    const bookingsBuilder = fromMock.mock.results[bookingsCallIndex].value as { eq: jest.Mock };
    expect(bookingsBuilder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(bookingsBuilder.eq).toHaveBeenCalledWith("status", "confirmed");
  });

  it("getProfileStats defaults counts to 0 when Supabase returns a null count", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: null, error: null, count: null },
      reviews: { data: null, error: null, count: null },
    });

    const stats = await getProfileStats(supabase, "user-1", "2026-01-15T00:00:00Z");

    expect(stats.tripCount).toBe(0);
    expect(stats.reviewCount).toBe(0);
  });
});
