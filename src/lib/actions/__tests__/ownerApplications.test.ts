/**
 * @jest-environment node
 */
import {
  requestOwnerAccessAction,
  submitOwnerApplicationAction,
  approveOwnerApplicationAction,
  rejectOwnerApplicationAction,
} from "../ownerApplications";
import { getServerClient } from "../auth";
import { requestOwnerAccess, submitOwnerApplication, approveOwnerApplication, rejectOwnerApplication } from "../../services/ownerApplications";
import { recordReferralStart, markReferralCompleted, markReferralApproved } from "../../services/referrals";
import type { OwnerApplication } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/ownerApplications", () => ({
  requestOwnerAccess: jest.fn(),
  submitOwnerApplication: jest.fn(),
  approveOwnerApplication: jest.fn(),
  rejectOwnerApplication: jest.fn(),
}));
jest.mock("../../services/referrals", () => ({
  recordReferralStart: jest.fn(),
  markReferralCompleted: jest.fn(),
  markReferralApproved: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockRequestOwnerAccess = requestOwnerAccess as jest.MockedFunction<typeof requestOwnerAccess>;
const mockSubmitOwnerApplication = submitOwnerApplication as jest.MockedFunction<typeof submitOwnerApplication>;
const mockApproveOwnerApplication = approveOwnerApplication as jest.MockedFunction<typeof approveOwnerApplication>;
const mockRejectOwnerApplication = rejectOwnerApplication as jest.MockedFunction<typeof rejectOwnerApplication>;
const mockRecordReferralStart = recordReferralStart as jest.MockedFunction<typeof recordReferralStart>;
const mockMarkReferralCompleted = markReferralCompleted as jest.MockedFunction<typeof markReferralCompleted>;
const mockMarkReferralApproved = markReferralApproved as jest.MockedFunction<typeof markReferralApproved>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

/** Matches refund.test.ts's own fakeClient — exercises the real requireAdmin() against a stubbed profiles lookup, rather than mocking requireAdmin itself. */
function fakeAdminClient(user: { id: string } | null, role: string | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: "not found" } }) })) })),
    })),
  } as never;
}

const APPLICATION = { id: "app-1", user_id: "user-1", status: "pending" } as OwnerApplication;

const validValues = {
  businessName: "Test Owner",
  businessPhone: "+639171234567",
  businessEmail: "owner@example.com",
  venueName: "Test Venue",
  venueAddress: "123 Test St",
  venueCity: "Cebu City",
  courtCount: 2,
  hasLiabilityInsurance: true,
  agreedToOwnerAgreement: true,
};

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockRequestOwnerAccess.mockReset();
  mockSubmitOwnerApplication.mockReset();
  mockApproveOwnerApplication.mockReset();
  mockRejectOwnerApplication.mockReset();
  mockRecordReferralStart.mockReset();
  mockMarkReferralCompleted.mockReset();
  mockMarkReferralApproved.mockReset();
});

describe("requestOwnerAccessAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await requestOwnerAccessAction();
    expect(result).toEqual({ success: false, error: "Sign in to apply as a venue owner." });
    expect(mockRequestOwnerAccess).not.toHaveBeenCalled();
  });

  it("requests owner access for the authenticated user, with no referral code", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockRequestOwnerAccess.mockResolvedValue(undefined);

    const result = await requestOwnerAccessAction();

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockRequestOwnerAccess).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(mockRecordReferralStart).not.toHaveBeenCalled();
  });

  it("records the referral when a code is given", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockRequestOwnerAccess.mockResolvedValue(undefined);
    mockRecordReferralStart.mockResolvedValue(undefined);

    await requestOwnerAccessAction("REF12345");

    expect(mockRecordReferralStart).toHaveBeenCalledWith(expect.anything(), "REF12345", "user-1");
  });

  it("maps a thrown service error to a friendly message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockRequestOwnerAccess.mockRejectedValue(new Error("connection reset"));

    const result = await requestOwnerAccessAction();

    expect(result).toEqual({ success: false, error: "We couldn't start your owner application." });
  });
});

describe("submitOwnerApplicationAction", () => {
  it("rejects invalid input before ever contacting Supabase", async () => {
    const result = await submitOwnerApplicationAction({ ...validValues, businessEmail: "not-an-email" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await submitOwnerApplicationAction(validValues);
    expect(result).toEqual({ success: false, error: "Sign in to submit your application." });
    expect(mockSubmitOwnerApplication).not.toHaveBeenCalled();
  });

  it("submits the application and marks any in-flight referral completed", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSubmitOwnerApplication.mockResolvedValue(APPLICATION);
    mockMarkReferralCompleted.mockResolvedValue(undefined);

    const result = await submitOwnerApplicationAction(validValues);

    expect(result).toEqual({ success: true, data: APPLICATION });
    expect(mockSubmitOwnerApplication).toHaveBeenCalledWith(expect.anything(), "user-1", validValues);
    expect(mockMarkReferralCompleted).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("maps a thrown service error to a friendly message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockSubmitOwnerApplication.mockRejectedValue(new Error("connection reset"));

    const result = await submitOwnerApplicationAction(validValues);

    expect(result).toEqual({ success: false, error: "We couldn't submit your application." });
  });
});

describe("approveOwnerApplicationAction", () => {
  it("rejects a non-admin session before ever calling approveOwnerApplication", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "user-1" }, "player") });
    const result = await approveOwnerApplicationAction("app-1");
    expect(result).toEqual({ success: false, error: "This area is admin-only." });
    expect(mockApproveOwnerApplication).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient(null, null) });
    const result = await approveOwnerApplicationAction("app-1");
    expect(result.success).toBe(false);
    expect(mockApproveOwnerApplication).not.toHaveBeenCalled();
  });

  it("approves the application and resolves any referral for an admin session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockApproveOwnerApplication.mockResolvedValue({ ...APPLICATION, status: "approved" });
    mockMarkReferralApproved.mockResolvedValue(undefined);

    const result = await approveOwnerApplicationAction("app-1");

    expect(result).toEqual({ success: true, data: { ...APPLICATION, status: "approved" } });
    expect(mockApproveOwnerApplication).toHaveBeenCalledWith(expect.anything(), "app-1", "admin-1");
    expect(mockMarkReferralApproved).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("falls back to the generic friendly-error mapper when the service throws", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockApproveOwnerApplication.mockRejectedValue(new Error("connection reset"));

    const result = await approveOwnerApplicationAction("app-1");

    expect(result).toEqual({ success: false, error: "We couldn't approve that application." });
  });
});

describe("rejectOwnerApplicationAction", () => {
  it("rejects a non-admin session before ever calling rejectOwnerApplication", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "user-1" }, "venue_owner") });
    const result = await rejectOwnerApplicationAction("app-1");
    expect(result).toEqual({ success: false, error: "This area is admin-only." });
    expect(mockRejectOwnerApplication).not.toHaveBeenCalled();
  });

  it("rejects the application for an admin session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockRejectOwnerApplication.mockResolvedValue({ ...APPLICATION, status: "rejected" });

    const result = await rejectOwnerApplicationAction("app-1");

    expect(result).toEqual({ success: true, data: { ...APPLICATION, status: "rejected" } });
    expect(mockRejectOwnerApplication).toHaveBeenCalledWith(expect.anything(), "app-1", "admin-1");
  });

  it("falls back to the generic friendly-error mapper when the service throws", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockRejectOwnerApplication.mockRejectedValue(new Error("connection reset"));

    const result = await rejectOwnerApplicationAction("app-1");

    expect(result).toEqual({ success: false, error: "We couldn't reject that application." });
  });
});
