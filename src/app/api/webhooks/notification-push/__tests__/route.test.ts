/**
 * @jest-environment node
 */
import { POST } from "../route";
import { createServiceRoleClient } from "../../../../../lib/supabase/serviceRole";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/supabase/serviceRole", () => ({ createServiceRoleClient: jest.fn() }));
// notificationHref/displayMessage are pure — left real.

const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

const SECRET = "test-webhook-secret";
const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

function fakeRequest(body: unknown, secret: string | null = SECRET) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-webhook-secret", secret);
  return new Request("https://air-rally.com/api/webhooks/notification-push", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Service-role client stub: select().eq() resolves tokens, delete().in() records prunes. */
function mockSupabase(tokens: { token: string }[] | null, options: { selectError?: Error } = {}) {
  const deletedTokens: string[][] = [];
  mockCreateServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue(
          options.selectError ? { data: null, error: options.selectError } : { data: tokens, error: null }
        ),
      }),
      delete: jest.fn().mockReturnValue({
        in: jest.fn().mockImplementation((_column: string, values: string[]) => {
          deletedTokens.push(values);
          return Promise.resolve({ error: null });
        }),
      }),
    }),
  } as never);
  return { deletedTokens };
}

function mockExpoResponse(tickets: Array<{ status: string; details?: { error?: string } }>) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: tickets }),
  });
}

const INSERT_PAYLOAD = {
  type: "INSERT",
  table: "notifications",
  schema: "public",
  record: {
    id: "notif-1",
    user_id: "user-1",
    type: "booking_confirmed",
    title: "Booking confirmed",
    message: "Your booking (confirmation #ABCD1234) is confirmed.",
    link_url: "/bookings/11111111-1111-4111-8111-111111111111/confirmation",
  },
};

describe("POST /api/webhooks/notification-push", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, SUPABASE_DB_WEBHOOK_SECRET: SECRET };
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("rejects when the secret env var is missing", async () => {
    delete process.env.SUPABASE_DB_WEBHOOK_SECRET;
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    expect(response.status).toBe(500);
  });

  it("rejects a wrong or missing secret header", async () => {
    expect((await POST(fakeRequest(INSERT_PAYLOAD, "wrong"))).status).toBe(401);
    expect((await POST(fakeRequest(INSERT_PAYLOAD, null))).status).toBe(401);
  });

  it("acknowledges but ignores non-notification events", async () => {
    const response = await POST(fakeRequest({ ...INSERT_PAYLOAD, table: "bookings" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
  });

  it("no-ops when the user has no registered tokens", async () => {
    mockSupabase([]);
    global.fetch = jest.fn();
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    expect(await response.json()).toEqual({ received: true, pushed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends one Expo message per token, carrying the notification's href", async () => {
    mockSupabase([{ token: "ExponentPushToken[aaa]" }, { token: "ExponentPushToken[bbb]" }]);
    global.fetch = mockExpoResponse([{ status: "ok" }, { status: "ok" }]);

    const response = await POST(fakeRequest(INSERT_PAYLOAD));

    expect(await response.json()).toEqual({ received: true, pushed: 2, pruned: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const sent = JSON.parse(init.body);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[aaa]",
      title: "Booking confirmed",
      body: "Your booking (confirmation #ABCD1234) is confirmed.",
      data: {
        url: "/bookings/11111111-1111-4111-8111-111111111111/confirmation",
        notificationId: "notif-1",
      },
    });
  });

  it("falls back to the type route when link_url is null", async () => {
    mockSupabase([{ token: "ExponentPushToken[aaa]" }]);
    global.fetch = mockExpoResponse([{ status: "ok" }]);

    await POST(
      fakeRequest({ ...INSERT_PAYLOAD, record: { ...INSERT_PAYLOAD.record, link_url: null } })
    );

    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(sent[0].data.url).toBe("/bookings");
  });

  it("prunes tokens Expo reports as DeviceNotRegistered", async () => {
    const { deletedTokens } = mockSupabase([
      { token: "ExponentPushToken[live]" },
      { token: "ExponentPushToken[dead]" },
    ]);
    global.fetch = mockExpoResponse([
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const response = await POST(fakeRequest(INSERT_PAYLOAD));

    expect(await response.json()).toEqual({ received: true, pushed: 1, pruned: 1 });
    expect(deletedTokens).toEqual([["ExponentPushToken[dead]"]]);
  });

  it("answers 200 with pushed: 0 when the token read fails", async () => {
    mockSupabase(null, { selectError: new Error("db down") });
    const response = await POST(fakeRequest(INSERT_PAYLOAD));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, pushed: 0 });
  });

  it("answers 200 when the Expo API itself fails", async () => {
    mockSupabase([{ token: "ExponentPushToken[aaa]" }]);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });

    const response = await POST(fakeRequest(INSERT_PAYLOAD));

    expect(response.status).toBe(200);
    // The chunk's tickets are unknown, so nothing is pruned and the count
    // still reflects the attempt — what matters is the 200.
    expect(await response.json()).toEqual({ received: true, pushed: 1, pruned: 0 });
  });
});
