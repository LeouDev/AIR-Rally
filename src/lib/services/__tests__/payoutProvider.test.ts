/**
 * @jest-environment node
 */
import {
  getPayoutProvider,
  assertNoPayoutExecutor,
  PayoutNotImplementedError,
  type TransferRequest,
} from "../payoutProvider";

/**
 * The point of these tests is the negative: prove that nothing can move
 * money, and that no external call can happen by accident.
 */

const REQUEST: TransferRequest = {
  payoutBatchId: "batch-1",
  venueId: "venue-1",
  providerAccountId: "acct_test",
  amount: 47500,
  currency: "PHP",
  idempotencyKey: "batch-1:venue-1",
};

describe("payout provider abstraction", () => {
  it("resolves a provider", () => {
    const provider = getPayoutProvider();
    expect(provider.name).toBe("PayMongo");
  });

  it("reports itself as not implemented", () => {
    expect(getPayoutProvider().implemented).toBe(false);
  });

  it.each(["createTransfer", "getTransferStatus", "cancelTransfer"] as const)("throws on %s", async (method) => {
    const provider = getPayoutProvider();
    const call =
      method === "createTransfer"
        ? provider.createTransfer(REQUEST)
        : method === "getTransferStatus"
          ? provider.getTransferStatus("tr_1")
          : provider.cancelTransfer("tr_1");

    await expect(call).rejects.toBeInstanceOf(PayoutNotImplementedError);
  });

  it("explains why in the error, rather than failing blankly", async () => {
    await expect(getPayoutProvider().createTransfer(REQUEST)).rejects.toThrow(/not implemented/i);
  });

  // The guard the payout batch layer depends on. It passes today; a future
  // phase that implements transfers will make it fail, which is the point —
  // it forces a review of everything that assumed money couldn't move.
  it("asserts no payout executor exists", () => {
    expect(() => assertNoPayoutExecutor()).not.toThrow();
  });

  it("returns the same provider instance on repeated calls", () => {
    expect(getPayoutProvider()).toBe(getPayoutProvider());
  });
});

describe("no external calls are possible", () => {
  // A payout provider that quietly reached PayMongo — even to read — would
  // undermine the claim that this phase cannot move money.
  it("makes no network call when a method is invoked", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    await expect(getPayoutProvider().createTransfer(REQUEST)).rejects.toThrow();
    await expect(getPayoutProvider().getTransferStatus("tr_1")).rejects.toThrow();
    await expect(getPayoutProvider().cancelTransfer("tr_1")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("makes no network call at import time", async () => {
    jest.resetModules();
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    await import("../providers/paymongo");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // The checkout client reads PAYMONGO_SECRET_KEY at module scope. Keeping
  // the payout provider free of that import is what makes "no key is read"
  // structurally true rather than a promise.
  it("does not import the PayMongo checkout client", () => {
    const source = jest.requireActual("fs").readFileSync(
      require.resolve("../providers/paymongo"),
      "utf8"
    ) as string;
    expect(source).not.toMatch(/from ["'].*services\/paymongo["']/);
    expect(source).not.toMatch(/fetch\(/);
  });
});
