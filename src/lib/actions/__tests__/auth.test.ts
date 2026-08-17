/**
 * @jest-environment node
 */
import { signUp, completeOAuthSignup } from "../auth";
import { createClient } from "../../supabase/server";
import { CURRENT_AGREEMENT_VERSION } from "../../legal";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("../../site", () => ({ getSiteUrl: jest.fn().mockResolvedValue("https://airrally.app") }));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

const VALID_INPUT = {
  firstName: "Jamie",
  lastName: "Cruz",
  email: "jamie@example.com",
  password: "password123",
  confirmPassword: "password123",
  agreedToTerms: true,
  intendedRole: "player" as const,
};

function fakeClient(overrides: { signUpResult?: unknown; signUpError?: unknown; rpc?: jest.Mock }) {
  const rpc = overrides.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null });
  return {
    auth: {
      signUp: jest.fn().mockResolvedValue({
        data: overrides.signUpResult ?? { user: { id: "user-1" }, session: { access_token: "tok" } },
        error: overrides.signUpError ?? null,
      }),
    },
    rpc,
  } as never;
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("signUp", () => {
  it("rejects without ever calling Supabase when agreedToTerms is false", async () => {
    const client = fakeClient({});
    mockCreateClient.mockResolvedValue(client);

    const result = await signUp({ ...VALID_INPUT, agreedToTerms: false });

    expect(result.success).toBe(false);
    expect((client as unknown as { auth: { signUp: jest.Mock } }).auth.signUp).not.toHaveBeenCalled();
  });

  // Every account starts as 'player' regardless of intendedRole (Phase
  // 6, Part 2) — intendedRole is a client-only routing hint the signUp()
  // action never reads or forwards; auth.signUp()'s own options.data
  // only ever carries name fields, and role/owner_status come purely
  // from the profiles table's own defaults via handle_new_user().
  it("never forwards intendedRole to auth.signUp() — role/owner_status are decided entirely by the profiles table default, not this action", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client = fakeClient({ rpc });
    mockCreateClient.mockResolvedValue(client);

    await signUp({ ...VALID_INPUT, intendedRole: "venue_owner" });

    const signUpCall = (client as unknown as { auth: { signUp: jest.Mock } }).auth.signUp.mock.calls[0][0];
    expect(signUpCall.options.data).toEqual({
      first_name: "Jamie",
      last_name: "Cruz",
      display_name: "Jamie Cruz",
    });
  });

  it("records agreement acceptance server-side, for the real new user id, after a successful signUp", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client = fakeClient({ rpc });
    mockCreateClient.mockResolvedValue(client);

    const result = await signUp(VALID_INPUT);

    expect(result).toEqual({ success: true, data: { requiresEmailConfirmation: false } });
    expect(rpc).toHaveBeenCalledWith("record_agreement_acceptance", {
      p_user_id: "user-1",
      p_agreement_version: CURRENT_AGREEMENT_VERSION,
    });
  });

  it("still records acceptance when email confirmation is pending (no session yet, but a real user id exists)", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client = fakeClient({ rpc, signUpResult: { user: { id: "user-2" }, session: null } });
    mockCreateClient.mockResolvedValue(client);

    const result = await signUp(VALID_INPUT);

    expect(result).toEqual({ success: true, data: { requiresEmailConfirmation: true } });
    expect(rpc).toHaveBeenCalledWith("record_agreement_acceptance", {
      p_user_id: "user-2",
      p_agreement_version: CURRENT_AGREEMENT_VERSION,
    });
  });

  it("still returns success even if recording the agreement acceptance fails — the auth account already exists and must not be stranded", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const client = fakeClient({ rpc });
    mockCreateClient.mockResolvedValue(client);

    const result = await signUp(VALID_INPUT);

    expect(result.success).toBe(true);
  });

  it("never calls the agreement RPC when Supabase auth.signUp itself fails", async () => {
    const rpc = jest.fn();
    const client = fakeClient({ rpc, signUpError: { message: "email already registered" } });
    mockCreateClient.mockResolvedValue(client);

    const result = await signUp(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("completeOAuthSignup", () => {
  function fakeSessionClient(overrides: { userId?: string | null; rpc?: jest.Mock }) {
    const rpc = overrides.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null });
    return {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: overrides.userId ? { id: overrides.userId } : null } }),
      },
      rpc,
    } as never;
  }

  it("rejects without calling Supabase when agreedToTerms is false", async () => {
    const client = fakeSessionClient({ userId: "user-1" });
    mockCreateClient.mockResolvedValue(client);

    const result = await completeOAuthSignup({ agreedToTerms: false, intendedRole: "player" });

    expect(result.success).toBe(false);
    expect((client as unknown as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled();
  });

  it("requires an active session — this is a continuation of OAuth, not a way to backdate acceptance for an arbitrary user", async () => {
    const client = fakeSessionClient({ userId: null });
    mockCreateClient.mockResolvedValue(client);

    const result = await completeOAuthSignup({ agreedToTerms: true, intendedRole: "player" });

    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect((client as unknown as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled();
  });

  it("records agreement acceptance for the CURRENT session's real user id, never trusting a client-supplied one", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client = fakeSessionClient({ userId: "user-9", rpc });
    mockCreateClient.mockResolvedValue(client);

    const result = await completeOAuthSignup({ agreedToTerms: true, intendedRole: "venue_owner" });

    expect(result).toEqual({ success: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("record_agreement_acceptance", {
      p_user_id: "user-9",
      p_agreement_version: CURRENT_AGREEMENT_VERSION,
    });
  });

  it("surfaces a friendly error when the RPC itself fails", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const client = fakeSessionClient({ userId: "user-1", rpc });
    mockCreateClient.mockResolvedValue(client);

    const result = await completeOAuthSignup({ agreedToTerms: true, intendedRole: "player" });

    expect(result.success).toBe(false);
  });
});
