/**
 * @jest-environment node
 */
import { startPaymongoOnboardingAction } from "../venueOnboarding";
import { getServerClient } from "../auth";
import { getVenueForOwner, linkVenuePaymongoAccount } from "../../services/venues";
import { createPayMongoMerchantAccount, createIdentityVerificationSession, activatePayMongoAccount } from "../../services/paymongoAccounts";
import type { Venue } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/venues", () => ({
  getVenueForOwner: jest.fn(),
  linkVenuePaymongoAccount: jest.fn(),
}));
jest.mock("../../services/paymongoAccounts", () => ({
  createPayMongoMerchantAccount: jest.fn(),
  createIdentityVerificationSession: jest.fn(),
  activatePayMongoAccount: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockGetVenueForOwner = getVenueForOwner as jest.MockedFunction<typeof getVenueForOwner>;
const mockLinkAccount = linkVenuePaymongoAccount as jest.MockedFunction<typeof linkVenuePaymongoAccount>;
const mockCreateAccount = createPayMongoMerchantAccount as jest.MockedFunction<typeof createPayMongoMerchantAccount>;
const mockCreateVerification = createIdentityVerificationSession as jest.MockedFunction<typeof createIdentityVerificationSession>;
const mockActivate = activatePayMongoAccount as jest.MockedFunction<typeof activatePayMongoAccount>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const BASE_VENUE: Venue = {
  id: "venue-1",
  owner_id: "user-1",
  name: "Rizal Pickleball Club",
  description: null,
  address: null,
  city: null,
  state_province: null,
  country: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
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
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockGetVenueForOwner.mockReset();
  mockLinkAccount.mockReset();
  mockCreateAccount.mockReset();
  mockCreateVerification.mockReset();
  mockActivate.mockReset();
  mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) } as never);
});

describe("startPaymongoOnboardingAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) } as never);

    const result = await startPaymongoOnboardingAction("venue-1");

    expect(result.success).toBe(false);
    expect(mockGetVenueForOwner).not.toHaveBeenCalled();
  });

  it("creates a new PayMongo account, links it, and returns the hosted verification url — for a not-yet-linked venue", async () => {
    mockGetVenueForOwner.mockResolvedValue(BASE_VENUE);
    mockCreateAccount.mockResolvedValue({ id: "org_new", type: "merchant", activation_status: "pending" });
    mockLinkAccount.mockResolvedValue(true);
    mockCreateVerification.mockResolvedValue({ id: "verif_1", account_id: "org_new", url: "https://paymongo.test/verify", status: "pending" });
    mockActivate.mockResolvedValue(undefined);

    const result = await startPaymongoOnboardingAction("venue-1");

    expect(mockCreateAccount).toHaveBeenCalledTimes(1);
    expect(mockLinkAccount).toHaveBeenCalledWith(expect.anything(), "venue-1", "org_new");
    expect(mockCreateVerification).toHaveBeenCalledWith("org_new");
    expect(mockActivate).toHaveBeenCalledWith("org_new");
    expect(result).toEqual({ success: true, data: { verificationUrl: "https://paymongo.test/verify" } });
  });

  it("reuses an already-linked account instead of creating a second one — idempotent, mirroring the Stripe Connect precedent", async () => {
    mockGetVenueForOwner.mockResolvedValue({ ...BASE_VENUE, paymongo_account_id: "org_existing", paymongo_activation_status: "pending" });
    mockCreateVerification.mockResolvedValue({ id: "verif_2", account_id: "org_existing", url: "https://paymongo.test/verify-again", status: "pending" });
    mockActivate.mockResolvedValue(undefined);

    const result = await startPaymongoOnboardingAction("venue-1");

    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockLinkAccount).not.toHaveBeenCalled();
    expect(mockCreateVerification).toHaveBeenCalledWith("org_existing");
    expect(result).toEqual({ success: true, data: { verificationUrl: "https://paymongo.test/verify-again" } });
  });

  it("returns a friendly error when the venue isn't found (or isn't owned by this session, indistinguishable via RLS)", async () => {
    mockGetVenueForOwner.mockResolvedValue(null);

    const result = await startPaymongoOnboardingAction("someone-elses-venue");

    expect(result.success).toBe(false);
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("returns a friendly error, without throwing, if linking fails (e.g. RLS refuses a concurrent double-click)", async () => {
    mockGetVenueForOwner.mockResolvedValue(BASE_VENUE);
    mockCreateAccount.mockResolvedValue({ id: "org_new", type: "merchant", activation_status: "pending" });
    mockLinkAccount.mockResolvedValue(false);

    const result = await startPaymongoOnboardingAction("venue-1");

    expect(result.success).toBe(false);
    expect(mockCreateVerification).not.toHaveBeenCalled();
  });
});
