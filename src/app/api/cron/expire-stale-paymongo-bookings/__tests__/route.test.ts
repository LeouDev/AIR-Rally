/**
 * @jest-environment node
 */
import { createQueryBuilder } from "../../../../../lib/test-helpers/mockSupabase";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../../../lib/supabase/serviceRole", () => ({ createServiceRoleClient: jest.fn() }));
jest.mock("../../../../../lib/services/paymongo", () => ({ retrievePayMongoCheckoutSession: jest.fn() }));
jest.mock("../../../../../lib/errors", () => ({ logServerError: jest.fn() }));

import { createServiceRoleClient } from "../../../../../lib/supabase/serviceRole";
import { retrievePayMongoCheckoutSession } from "../../../../../lib/services/paymongo";
import { POST } from "../route";

const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
const mockRetrieve = retrievePayMongoCheckoutSession as jest.MockedFunction<typeof retrievePayMongoCheckoutSession>;

const SECRET = "test-secret-value";

function request(secret: string | null) {
  const url = secret ? `https://x/api/cron/expire-stale-paymongo-bookings?x=1` : `https://x/api/cron/expire-stale-paymongo-bookings`;
  return new Request(url, { method: "POST", headers: secret ? { "x-webhook-secret": secret } : {} });
}

beforeEach(() => {
  process.env.EXPIRE_PAYMONGO_BOOKINGS_WEBHOOK_SECRET = SECRET;
  mockRetrieve.mockReset();
});

afterEach(() => {
  delete process.env.EXPIRE_PAYMONGO_BOOKINGS_WEBHOOK_SECRET;
});

describe("POST /api/cron/expire-stale-paymongo-bookings", () => {
  it("rejects a request without the correct secret", async () => {
    const res = await POST(request("wrong"));
    expect(res.status).toBe(401);
  });

  it("THE CRITICAL CASE: a booking with a non-failed payment attempt is NOT cancelled", async () => {
    const rpcMock = jest.fn();
    const client = {
      from: jest.fn(() =>
        createQueryBuilder({
          data: [{ id: "booking-in-flight", paymongo_checkout_session_id: "cs_live_1" }],
          error: null,
        })
      ),
      rpc: rpcMock,
    };
    mockCreateServiceRoleClient.mockReturnValue(client as never);
    // Realistic PayMongo shape: a "processing" attempt, matching what
    // reconcilePaymongoPendingBooking()'s own tests already prove this
    // status means "possibly still live."
    mockRetrieve.mockResolvedValue({
      id: "cs_live_1",
      attributes: {
        payment_intent: {
          id: "pi_1",
          attributes: {
            amount: 50000,
            currency: "PHP",
            status: "processing",
            payments: [{ id: "pay_1", attributes: { amount: 50000, currency: "php", status: "processing" } }],
          },
        },
      },
    });

    const res = await POST(request(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ candidates: 1, expired: 0, keptInFlight: 1, checkFailed: 0 });
    // The one assertion that matters most: the cancel RPC must never be
    // called for a booking PayMongo shows as possibly still paying.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("cancels a booking with no payment attempt at all (genuinely abandoned)", async () => {
    const rpcMock = jest.fn().mockResolvedValue({ data: true, error: null });
    const client = {
      from: jest.fn(() =>
        createQueryBuilder({
          data: [{ id: "booking-abandoned", paymongo_checkout_session_id: "cs_dead_1" }],
          error: null,
        })
      ),
      rpc: rpcMock,
    };
    mockCreateServiceRoleClient.mockReturnValue(client as never);
    mockRetrieve.mockResolvedValue({
      id: "cs_dead_1",
      attributes: { payment_intent: { id: "pi_2", attributes: { amount: 50000, currency: "PHP", status: "awaiting_payment_method", payments: [] } } },
    });

    const res = await POST(request(SECRET));
    const body = await res.json();

    expect(body).toEqual({ candidates: 1, expired: 1, keptInFlight: 0, checkFailed: 0 });
    expect(rpcMock).toHaveBeenCalledWith("expire_specific_pending_booking", { p_booking_id: "booking-abandoned" });
  });

  it("cancels a booking with only known-failed attempts (a failed attempt is not a live one)", async () => {
    const rpcMock = jest.fn().mockResolvedValue({ data: true, error: null });
    const client = {
      from: jest.fn(() => createQueryBuilder({ data: [{ id: "booking-failed", paymongo_checkout_session_id: "cs_failed_1" }], error: null })),
      rpc: rpcMock,
    };
    mockCreateServiceRoleClient.mockReturnValue(client as never);
    mockRetrieve.mockResolvedValue({
      id: "cs_failed_1",
      attributes: {
        payment_intent: {
          id: "pi_3",
          attributes: {
            amount: 50000,
            currency: "PHP",
            status: "awaiting_payment_method",
            payments: [{ id: "pay_1", attributes: { amount: 50000, currency: "php", status: "failed" } }],
          },
        },
      },
    });

    const res = await POST(request(SECRET));
    const body = await res.json();
    expect(body.expired).toBe(1);
    expect(body.keptInFlight).toBe(0);
  });

  it("skips (never cancels) a booking when PayMongo itself errors — fails toward NOT cancelling", async () => {
    const rpcMock = jest.fn();
    const client = {
      from: jest.fn(() => createQueryBuilder({ data: [{ id: "booking-unreachable", paymongo_checkout_session_id: "cs_err_1" }], error: null })),
      rpc: rpcMock,
    };
    mockCreateServiceRoleClient.mockReturnValue(client as never);
    mockRetrieve.mockRejectedValue(new Error("PayMongo 503"));

    const res = await POST(request(SECRET));
    const body = await res.json();

    expect(body).toEqual({ candidates: 1, expired: 0, keptInFlight: 0, checkFailed: 1 });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("handles a mix of candidates independently and correctly", async () => {
    const rpcMock = jest.fn().mockResolvedValue({ data: true, error: null });
    const client = {
      from: jest.fn(() =>
        createQueryBuilder({
          data: [
            { id: "b-inflight", paymongo_checkout_session_id: "cs_1" },
            { id: "b-abandoned", paymongo_checkout_session_id: "cs_2" },
          ],
          error: null,
        })
      ),
      rpc: rpcMock,
    };
    mockCreateServiceRoleClient.mockReturnValue(client as never);
    mockRetrieve.mockImplementation(async (sessionId: string) => {
      if (sessionId === "cs_1") {
        return {
          id: "cs_1",
          attributes: {
            payment_intent: {
              id: "pi_1",
              attributes: { amount: 1, currency: "PHP", status: "processing", payments: [{ id: "p1", attributes: { amount: 1, currency: "php", status: "processing" } }] },
            },
          },
        };
      }
      return { id: "cs_2", attributes: { payment_intent: null } };
    });

    const res = await POST(request(SECRET));
    const body = await res.json();

    expect(body).toEqual({ candidates: 2, expired: 1, keptInFlight: 1, checkFailed: 0 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("expire_specific_pending_booking", { p_booking_id: "b-abandoned" });
  });
});
