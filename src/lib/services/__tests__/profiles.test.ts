import { updateProfile } from "@/lib/services/profiles";
import { createMockSupabase } from "@/lib/test-helpers/mockSupabase";

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
});
