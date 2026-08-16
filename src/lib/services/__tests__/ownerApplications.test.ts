import {
  requestOwnerAccess,
  submitOwnerApplication,
  getOwnerApplicationForUser,
  listOwnerApplicationsForAdmin,
  getOwnerApplicationForAdmin,
  approveOwnerApplication,
  rejectOwnerApplication,
} from "@/lib/services/ownerApplications";
import { createMockSupabase, createTableMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { OwnerApplication } from "@/lib/supabase/types";

const APPLICATION: OwnerApplication = {
  id: "app-1",
  user_id: "user-1",
  business_name: "Test Owner",
  business_phone: "+639171234567",
  business_email: "owner@example.com",
  venue_name: "Test Venue",
  venue_address: "123 Test St",
  venue_city: "Cebu City",
  venue_description: null,
  court_count: 2,
  status: "pending",
  reviewed_at: null,
  reviewed_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("requestOwnerAccess", () => {
  it("resolves without error on a successful update", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(requestOwnerAccess(supabase, "user-1")).resolves.toBeUndefined();
  });

  // prevent_owner_status_tampering() is the actual enforcement of "only
  // none|rejected -> pending is allowed for a non-admin self-update" — this
  // just proves a database error surfaces as a thrown error, not a silent no-op.
  it("propagates a database error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501") });
    await expect(requestOwnerAccess(supabase, "user-1")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("submitOwnerApplication", () => {
  it("inserts the application under the given user id", async () => {
    const supabase = createMockSupabase({ data: APPLICATION, error: null });
    const result = await submitOwnerApplication(supabase, "user-1", {
      businessName: "Test Owner",
      businessPhone: "+639171234567",
      businessEmail: "owner@example.com",
      venueName: "Test Venue",
      venueAddress: "123 Test St",
      venueCity: "Cebu City",
      courtCount: 2,
    });
    expect(result).toEqual(APPLICATION);
  });
});

describe("getOwnerApplicationForUser", () => {
  it("returns the most recent application for the user", async () => {
    const supabase = createMockSupabase({ data: APPLICATION, error: null });
    await expect(getOwnerApplicationForUser(supabase, "user-1")).resolves.toEqual(APPLICATION);
  });

  it("returns null when the user has never applied", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getOwnerApplicationForUser(supabase, "user-1")).resolves.toBeNull();
  });
});

describe("listOwnerApplicationsForAdmin", () => {
  it("returns all applications when no status filter is given", async () => {
    const supabase = createMockSupabase({ data: [APPLICATION], error: null });
    await expect(listOwnerApplicationsForAdmin(supabase)).resolves.toEqual([APPLICATION]);
  });

  it("filters by status when given", async () => {
    const eqMock = jest.fn(() => Promise.resolve({ data: [], error: null }));
    const orderMock = jest.fn(() => ({ eq: eqMock }));
    const supabase = { from: jest.fn(() => ({ select: jest.fn(() => ({ order: orderMock })) })) } as never;

    await listOwnerApplicationsForAdmin(supabase, "approved");

    expect(eqMock).toHaveBeenCalledWith("status", "approved");
  });
});

describe("getOwnerApplicationForAdmin", () => {
  it("returns the application by id", async () => {
    const supabase = createMockSupabase({ data: APPLICATION, error: null });
    await expect(getOwnerApplicationForAdmin(supabase, "app-1")).resolves.toEqual(APPLICATION);
  });

  it("returns null when not found", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(getOwnerApplicationForAdmin(supabase, "app-1")).resolves.toBeNull();
  });
});

describe("approveOwnerApplication", () => {
  it("throws when the application doesn't exist", async () => {
    const supabase = createTableMockSupabase({ owner_applications: { data: null, error: null } });
    await expect(approveOwnerApplication(supabase, "app-1", "admin-1")).rejects.toThrow("Application not found.");
  });

  // The real "distinct admin, distinct applicant" grant was additionally
  // verified live against staging (profiles_prevent_role_change only
  // guards self-updates, so an admin acting on someone else's row is
  // untouched by it) — this test only proves the service layer issues
  // the right two updates with the right payloads.
  it("sets the application to approved and grants the applicant venue_owner + owner_status='approved'", async () => {
    const applicationsUpdateMock = jest.fn(() => ({
      eq: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { ...APPLICATION, status: "approved" }, error: null }) })) })),
    }));
    const profilesUpdateMock = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }));

    let applicationsCallCount = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "owner_applications") {
          applicationsCallCount += 1;
          if (applicationsCallCount === 1) {
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: APPLICATION, error: null }) })) })) };
          }
          return { update: applicationsUpdateMock };
        }
        if (table === "profiles") {
          return { update: profilesUpdateMock };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    const result = await approveOwnerApplication(supabase, "app-1", "admin-1");

    expect(result.status).toBe("approved");
    expect(applicationsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", reviewed_by: "admin-1" })
    );
    expect(profilesUpdateMock).toHaveBeenCalledWith({ role: "venue_owner", owner_status: "approved" });
  });
});

describe("rejectOwnerApplication", () => {
  it("throws when the application doesn't exist", async () => {
    const supabase = createTableMockSupabase({ owner_applications: { data: null, error: null } });
    await expect(rejectOwnerApplication(supabase, "app-1", "admin-1")).rejects.toThrow("Application not found.");
  });

  it("sets the application to rejected and sets owner_status='rejected' (role untouched)", async () => {
    const applicationsUpdateMock = jest.fn(() => ({
      eq: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { ...APPLICATION, status: "rejected" }, error: null }) })) })),
    }));
    const profilesUpdateMock = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }));

    let applicationsCallCount = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "owner_applications") {
          applicationsCallCount += 1;
          if (applicationsCallCount === 1) {
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: APPLICATION, error: null }) })) })) };
          }
          return { update: applicationsUpdateMock };
        }
        if (table === "profiles") {
          return { update: profilesUpdateMock };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    const result = await rejectOwnerApplication(supabase, "app-1", "admin-1");

    expect(result.status).toBe("rejected");
    expect(profilesUpdateMock).toHaveBeenCalledWith({ owner_status: "rejected" });
  });
});
