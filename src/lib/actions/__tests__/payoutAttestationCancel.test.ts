/**
 * @jest-environment node
 */
import { cancelPayoutTransferAction } from "../payoutAttestation";
import { getServerClient } from "../auth";
import { requireAdmin } from "../../services/admin";
import { cancelPayoutTransfer } from "../../services/payoutAttestation";

// Relative paths, not the `@/` alias — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("../../services/payoutAttestation", () => ({
  recordPayoutTransfers: jest.fn(),
  attestPayoutSent: jest.fn(),
  attestPayoutSettled: jest.fn(),
  attestPayoutFailed: jest.fn(),
  cancelPayoutTransfer: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockCancel = cancelPayoutTransfer as jest.MockedFunction<typeof cancelPayoutTransfer>;

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.mockResolvedValue({ ok: true, client: {} as never } as never);
  mockAdmin.mockResolvedValue({ ok: true } as never);
});

const call = () =>
  cancelPayoutTransferAction({
    transferId: "00000000-0000-4000-8000-000000000001",
    batchId: "00000000-0000-4000-8000-000000000002",
    reason: "uploaded the wrong file",
  });

/**
 * WHY THIS EXISTS. cancel_payout_transfer() updates
 * `where status in ('pending','processing')` and raises P0002 when zero rows
 * match — which is the SAME raise for "already cancelled" and "never
 * cancellable". QA hit this on 2026-08-26: the first click succeeded
 * server-side, the browser aborted before rendering anything, and the second
 * click was told "We couldn't cancel that."
 *
 * That message says TRY AGAIN about a destructive action that had already
 * worked. These two cases need opposite responses from the person reading
 * them, so they must not share a message.
 */
describe("cancelPayoutTransferAction — telling the operator the right thing", () => {
  it("does not say 'try again' when the transfer is already gone", async () => {
    // P0002 verified against the live database, not assumed: calling
    // cancel_payout_transfer() with an unknown id returns code P0002.
    mockCancel.mockRejectedValue(
      Object.assign(new Error("No pending or uploaded transfer with that id"), { code: "P0002" }),
    );
    const result = await call();
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");

    expect(result.error).toMatch(/no longer pending/i);
    expect(result.error).toMatch(/already have been cancelled|confirmed as sent/i);
    // The discriminator: the OLD message must not survive.
    expect(result.error).not.toMatch(/We couldn't cancel that/i);
  });

  it("tells them to go and look rather than to retry", async () => {
    mockCancel.mockRejectedValue(Object.assign(new Error("x"), { code: "P0002" }));
    const result = await call();
    if (result.success) throw new Error("unreachable");
    expect(result.error).toMatch(/refresh/i);
  });

  it("still reports a genuine failure as a failure", async () => {
    // A real error — not P0002 — must NOT be reported as "already cancelled",
    // or a broken cancel would read as a successful one.
    mockCancel.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "08006" }));
    const result = await call();
    if (result.success) throw new Error("unreachable");
    expect(result.error).not.toMatch(/no longer pending/i);
  });

  it("succeeds quietly when the cancel works", async () => {
    mockCancel.mockResolvedValue(undefined as never);
    const result = await call();
    expect(result.success).toBe(true);
  });
});
