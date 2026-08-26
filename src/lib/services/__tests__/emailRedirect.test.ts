/**
 * @jest-environment node
 */
import { sendEmail } from "../email";

const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));
jest.mock("../../errors", () => ({ logServerError: jest.fn() }));

const PROD_URL = "https://hrpbjudsrqcgyrkkodop.supabase.co";
const STAGING_URL = "https://vdxdmtsnptzodabaojlc.supabase.co";

const ORIGINAL = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  process.env = { ...ORIGINAL, RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "noreply@air-rally.com" };
  mockSend.mockResolvedValue({ error: null });
});
afterAll(() => { process.env = ORIGINAL; });

const send = () => sendEmail({ to: "someone@real-person.com", subject: "Your payout", html: "<p>x</p>" });

/**
 * Staging carries accounts with real-looking addresses. Without a redirect,
 * testing an email change there can send a real person something that looks
 * like a genuine AIR/Rally notification -- worse than not being able to test
 * email at all, and why the payslip was verified against production instead.
 */
describe("email redirect on non-production deployments", () => {
  it("sends to the real recipient on production, untouched", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    process.env.EMAIL_REDIRECT_TO = "founder@example.com"; // must be IGNORED here
    expect(await send()).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "someone@real-person.com", subject: "Your payout" }),
    );
  });

  it("redirects every recipient to one address off production", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
    process.env.EMAIL_REDIRECT_TO = "founder@example.com";
    expect(await send()).toBe(true);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("founder@example.com");
    expect(arg.to).not.toBe("someone@real-person.com");
  });

  it("keeps the intended recipient visible in the subject", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
    process.env.EMAIL_REDIRECT_TO = "founder@example.com";
    await send();
    expect(mockSend.mock.calls[0][0].subject).toBe("[staging → someone@real-person.com] Your payout");
  });

  /**
   * THE DISCRIMINATOR. A missing redirect must NOT fall back to sending
   * normally -- that is precisely the mistake the guard exists to prevent,
   * and it is the failure mode an env-var-says-I-am-production design has.
   */
  it("FAILS CLOSED: sends nothing off production when no redirect is configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
    delete process.env.EMAIL_REDIRECT_TO;
    expect(await send()).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("also fails closed when the deployment is unconfigured entirely", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.EMAIL_REDIRECT_TO;
    expect(await send()).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("treats a blank redirect as unset rather than as an address", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
    process.env.EMAIL_REDIRECT_TO = "   ";
    expect(await send()).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
