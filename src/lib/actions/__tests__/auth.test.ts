/**
 * @jest-environment node
 */
import { signUp } from "../auth";
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
