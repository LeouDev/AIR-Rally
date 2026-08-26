/**
 * @jest-environment node
 */
// Relative path for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("resend", () => {
  const send = jest.fn();
  return { Resend: jest.fn().mockImplementation(() => ({ emails: { send } })), __mockSend: send };
});

import { sendEmail } from "../email";
const mockSend = (jest.requireMock("resend") as { __mockSend: jest.Mock }).__mockSend;

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  // These cases exercise the PRODUCTION send path -- a real recipient, no
  // redirect. sendEmail() now refuses to send from any deployment it cannot
  // identify as production (see emailRedirect.test.ts for why it fails closed),
  // so the production Supabase URL has to be present for them to mean anything.
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "AIR/Rally <notifications@air-rally.com>",
    NEXT_PUBLIC_SUPABASE_URL: "https://hrpbjudsrqcgyrkkodop.supabase.co",
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("sendEmail", () => {
  it("sends through Resend with the configured from address", async () => {
    mockSend.mockResolvedValue({ data: { id: "email_1" }, error: null });

    const result = await sendEmail({ to: "player@example.test", subject: "Hi", html: "<p>Hi</p>" });

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      from: "AIR/Rally <notifications@air-rally.com>",
      to: "player@example.test",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
  });

  it("returns false, never throws, when Resend reports an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "invalid recipient" } });
    await expect(sendEmail({ to: "bad", subject: "Hi", html: "<p>Hi</p>" })).resolves.toBe(false);
  });

  it("returns false, never throws, when the SDK call itself rejects", async () => {
    mockSend.mockRejectedValue(new Error("network error"));
    await expect(sendEmail({ to: "player@example.test", subject: "Hi", html: "<p>Hi</p>" })).resolves.toBe(false);
  });

  it("returns false without calling Resend when RESEND_FROM_EMAIL is unset", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    await expect(sendEmail({ to: "player@example.test", subject: "Hi", html: "<p>Hi</p>" })).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
