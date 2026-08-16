/**
 * @jest-environment node
 */
import { requireAdmin } from "../admin";

function fakeClient(user: { id: string } | null, role: string | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: "not found" } }) })) })),
    })),
  } as never;
}

describe("requireAdmin", () => {
  it("rejects when there is no session", async () => {
    const result = await requireAdmin(fakeClient(null, null));
    expect(result).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
  });

  it("rejects a non-admin role", async () => {
    const result = await requireAdmin(fakeClient({ id: "user-1" }, "player"));
    expect(result).toEqual({ ok: false, error: "This area is admin-only." });
  });

  it("rejects when the profile lookup errors", async () => {
    const result = await requireAdmin(fakeClient({ id: "user-1" }, null));
    expect(result).toEqual({ ok: false, error: "This area is admin-only." });
  });

  it("returns the real authenticated user id for an admin", async () => {
    const result = await requireAdmin(fakeClient({ id: "admin-1" }, "admin"));
    expect(result).toEqual({ ok: true, userId: "admin-1" });
  });
});
