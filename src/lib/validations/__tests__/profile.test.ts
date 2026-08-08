import { updateProfileSchema } from "@/lib/validations/profile";

const base = {
  firstName: "Jamie",
  lastName: "Cruz",
  displayName: "Jamie C.",
  phone: "",
  avatarUrl: "",
};

describe("updateProfileSchema", () => {
  it("accepts valid values with blank optional phone/avatar", () => {
    expect(updateProfileSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a valid phone number and avatar URL", () => {
    const result = updateProfileSchema.safeParse({
      ...base,
      phone: "+63 917 123 4567",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed phone number", () => {
    expect(updateProfileSchema.safeParse({ ...base, phone: "call me maybe" }).success).toBe(false);
  });

  it("rejects a non-URL avatar value", () => {
    expect(updateProfileSchema.safeParse({ ...base, avatarUrl: "not a url" }).success).toBe(false);
  });

  it("requires a non-blank display name", () => {
    expect(updateProfileSchema.safeParse({ ...base, displayName: "" }).success).toBe(false);
  });

  // Users must never be able to grant themselves a role through the
  // profile-edit form — the schema has no `role` field at all, so even a
  // request forged with an extra `role` key has it silently stripped
  // before it ever reaches lib/services/profiles.ts. Defense in depth
  // alongside the DB-level trigger (see supabase/migrations).
  it("strips a role field even if a client sends one", () => {
    const result = updateProfileSchema.safeParse({ ...base, role: "admin" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("role");
    }
  });
});
