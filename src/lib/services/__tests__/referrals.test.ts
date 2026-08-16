import { recordReferralStart, markReferralCompleted, markReferralApproved, listReferralsForUser } from "@/lib/services/referrals";
import { createMockSupabase } from "@/lib/test-helpers/mockSupabase";
import type { Referral } from "@/lib/supabase/types";

const REFERRAL: Referral = {
  id: "ref-1",
  referral_code: "ABC12345",
  referrer_user_id: "referrer-1",
  referred_user_id: "referred-1",
  converted_owner_id: null,
  status: "started",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("recordReferralStart", () => {
  it("resolves referrer_user_id from the code and inserts a 'started' row", async () => {
    const insertMock = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "profiles") {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { id: "referrer-1" }, error: null }) })) })) };
        }
        return { insert: insertMock };
      }),
    } as never;

    await recordReferralStart(supabase, "ABC12345", "referred-1");

    expect(insertMock).toHaveBeenCalledWith({
      referral_code: "ABC12345",
      referrer_user_id: "referrer-1",
      referred_user_id: "referred-1",
      status: "started",
    });
  });

  it("silently no-ops for an unknown/garbage referral code — never trusts a client-supplied referrer id", async () => {
    const insertMock = jest.fn();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "profiles") {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) };
        }
        return { insert: insertMock };
      }),
    } as never;

    await recordReferralStart(supabase, "NOTREAL", "referred-1");

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("silently no-ops when someone tries to refer themselves", async () => {
    const insertMock = jest.fn();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "profiles") {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { id: "user-1" }, error: null }) })) })) };
        }
        return { insert: insertMock };
      }),
    } as never;

    await recordReferralStart(supabase, "OWNCODE1", "user-1");

    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("markReferralCompleted", () => {
  it("updates status to completed, scoped to the referred user and started status", async () => {
    const eqStatusMock = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const eqUserMock = jest.fn(() => ({ eq: eqStatusMock }));
    const updateMock = jest.fn(() => ({ eq: eqUserMock }));
    const supabase = { from: jest.fn(() => ({ update: updateMock })) } as never;

    await markReferralCompleted(supabase, "referred-1");

    expect(updateMock).toHaveBeenCalledWith({ status: "completed" });
    expect(eqUserMock).toHaveBeenCalledWith("referred_user_id", "referred-1");
    expect(eqStatusMock).toHaveBeenCalledWith("status", "started");
  });
});

describe("markReferralApproved", () => {
  it("updates status to approved and sets converted_owner_id", async () => {
    const inMock = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const eqUserMock = jest.fn(() => ({ in: inMock }));
    const updateMock = jest.fn(() => ({ eq: eqUserMock }));
    const supabase = { from: jest.fn(() => ({ update: updateMock })) } as never;

    await markReferralApproved(supabase, "referred-1");

    expect(updateMock).toHaveBeenCalledWith({ status: "approved", converted_owner_id: "referred-1" });
    expect(inMock).toHaveBeenCalledWith("status", ["started", "completed"]);
  });
});

describe("listReferralsForUser", () => {
  it("returns the referrer's own referrals", async () => {
    const supabase = createMockSupabase({ data: [REFERRAL], error: null });
    await expect(listReferralsForUser(supabase, "referrer-1")).resolves.toEqual([REFERRAL]);
  });
});
