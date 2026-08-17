/**
 * @jest-environment node
 */
import { POST } from "../route";
import { createServiceRoleClient } from "../../../../../lib/supabase/serviceRole";
import { sendEmail } from "../../../../../lib/services/email";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/supabase/serviceRole", () => ({ createServiceRoleClient: jest.fn() }));
jest.mock("../../../../../lib/services/email", () => ({ sendEmail: jest.fn() }));

const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

const SECRET = "test-webhook-secret";
const ORIGINAL_ENV = process.env;

function fakeRequest(body: unknown, secret: string | null = SECRET) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-webhook-secret", secret);
  return new Request("https://air-rally.com/api/webhooks/notification-created", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function mockGetUserById(result: { email: string } | null) {
  mockCreateServiceRoleClient.mockReturnValue({
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue(
          result ? { data: { user: { email: result.email } }, error: null } : { data: { user: null }, error: new Error("not found") }
        ),
      },
    },
  } as never);
}

const INSERT_PAYLOAD = {
  type: "INSERT",
  table: "notifications",
  schema: "public",
  record: {
    id: "notif-1",
    user_id: "user-1",
    type: "credits_added",
    title: "Credits added",
    message: "₱400.00 in credits have been added to your account.",
    link_url: null,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SUPABASE_DB_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: "https://air-rally.com" };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/webhooks/notification-created", () => {
  it("rejects a request with no secret configured server-side", async () => {
    delete process.env.SUPABASE_DB_WEBHOOK_SECRET;
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    expect(response.status).toBe(500);
  });

  it("rejects a request with a missing or wrong secret", async () => {
    const response = await POST(fakeRequest(INSERT_PAYLOAD, "wrong"));
    expect(response.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores an event that isn't an INSERT on notifications", async () => {
    const response = await POST(fakeRequest({ ...INSERT_PAYLOAD, type: "UPDATE" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ignored: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("looks up the recipient's email and sends, routing through notificationHref for the link", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(true);

    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: true });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "player@example.test",
        subject: "Credits added",
        // credits_added has no link_url, so it falls back to TYPE_ROUTES —
        // the exact fix this PR made routes it to /profile/credits, not /profile.
        html: expect.stringContaining("https://air-rally.com/profile/credits"),
      })
    );
  });

  it("prefers the notification's own link_url over the type-based fallback", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(true);

    await POST(fakeRequest({ ...INSERT_PAYLOAD, record: { ...INSERT_PAYLOAD.record, link_url: "/events/abc" } }));

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("https://air-rally.com/events/abc") }));
  });

  it("still returns 200 when the user has no email on file — never blocks on a mail failure", async () => {
    mockGetUserById(null);
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when sendEmail itself fails", async () => {
    mockGetUserById({ email: "player@example.test" });
    mockSendEmail.mockResolvedValue(false);
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
  });

  it("still returns 200 even when an unexpected error is thrown", async () => {
    mockCreateServiceRoleClient.mockImplementation(() => {
      throw new Error("boom");
    });
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ received: true, emailed: false });
  });

  it("rejects malformed JSON", async () => {
    const headers = new Headers({ "x-webhook-secret": SECRET });
    const request = new Request("https://air-rally.com/api/webhooks/notification-created", { method: "POST", headers, body: "not json" });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
