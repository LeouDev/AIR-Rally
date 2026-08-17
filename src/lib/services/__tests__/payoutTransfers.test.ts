/**
 * @jest-environment node
 */
import { decideTransferRetry, canMarkSettlementSettled, assertTransferExecutionAllowed } from "../payoutTransfers";
import { isPaymongoTransfersEnabled, TransferNotEnabledError, paymongoTransferProvider } from "../providers/paymongoTransfers";
import type { TransferRequest } from "../payoutProvider";

const REQUEST: TransferRequest = {
  payoutBatchId: "batch-1",
  venueId: "venue-1",
  providerAccountId: "acct_test",
  amount: 10000,
  currency: "PHP",
  idempotencyKey: "ref-1",
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("transfers are disabled by default", () => {
  it("reports disabled when the flag is unset", () => {
    delete process.env.PAYMONGO_TRANSFERS_ENABLED;
    expect(isPaymongoTransfersEnabled()).toBe(false);
  });

  it.each(["false", "", "1", "TRUE", "yes"])("stays disabled for %p", (value) => {
    process.env.PAYMONGO_TRANSFERS_ENABLED = value;
    expect(isPaymongoTransfersEnabled()).toBe(false);
  });

  it("enables only on the exact string 'true'", () => {
    process.env.PAYMONGO_TRANSFERS_ENABLED = "true";
    expect(isPaymongoTransfersEnabled()).toBe(true);
  });

  it.each(["createTransfer", "getTransferStatus", "cancelTransfer", "findTransferByReference"] as const)(
    "refuses %s while disabled",
    async (method) => {
      delete process.env.PAYMONGO_TRANSFERS_ENABLED;
      const call =
        method === "createTransfer"
          ? paymongoTransferProvider.createTransfer(REQUEST)
          : method === "getTransferStatus"
            ? paymongoTransferProvider.getTransferStatus("tr_1")
            : method === "cancelTransfer"
              ? paymongoTransferProvider.cancelTransfer("tr_1")
              : paymongoTransferProvider.findTransferByReference("ref-1");

      await expect(call).rejects.toBeInstanceOf(TransferNotEnabledError);
    }
  );

  // The flag alone is not enough: enabling transfers for sandbox work while
  // a live key happens to be configured is the one mistake here that spends
  // real money.
  it("refuses even when enabled if the key is not a test key", async () => {
    process.env.PAYMONGO_TRANSFERS_ENABLED = "true";
    process.env.PAYMONGO_SECRET_KEY = "sk_live_pretend";
    await expect(paymongoTransferProvider.createTransfer(REQUEST)).rejects.toThrow(/not a test key/i);
  });

  it("still refuses to execute with the flag on and a test key, because no wallet exists", async () => {
    process.env.PAYMONGO_TRANSFERS_ENABLED = "true";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_pretend";
    await expect(paymongoTransferProvider.createTransfer(REQUEST)).rejects.toThrow(/no PayMongo wallet/i);
  });

  it("never reports itself as implemented", () => {
    expect(paymongoTransferProvider.implemented).toBe(false);
  });
});

describe("no API calls happen while disabled", () => {
  it("makes no network request on any method", async () => {
    delete process.env.PAYMONGO_TRANSFERS_ENABLED;
    const fetchSpy = jest.spyOn(globalThis, "fetch");

    await expect(paymongoTransferProvider.createTransfer(REQUEST)).rejects.toThrow();
    await expect(paymongoTransferProvider.getTransferStatus("tr_1")).rejects.toThrow();
    await expect(paymongoTransferProvider.findTransferByReference("ref-1")).rejects.toThrow();
    expect(() => paymongoTransferProvider.handleWebhookEvent({})).toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("makes no network request even when enabled with a test key", async () => {
    process.env.PAYMONGO_TRANSFERS_ENABLED = "true";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_pretend";
    const fetchSpy = jest.spyOn(globalThis, "fetch");

    await expect(paymongoTransferProvider.createTransfer(REQUEST)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("decideTransferRetry", () => {
  it("allows sending when nothing has been sent", () => {
    expect(decideTransferRetry({ status: "pending", providerTransferId: null })).toMatchObject({ action: "send" });
  });

  // The timeout case. PayMongo publishes no idempotency key for transfers
  // and its guide suggests retrying with a NEW reference, which would
  // double-pay — so this must never resolve to "send".
  it("demands a lookup when a transfer was sent but never confirmed", () => {
    const decision = decideTransferRetry({ status: "processing", providerTransferId: null });
    expect(decision.action).toBe("lookup_first");
    expect(decision.reason).toMatch(/double|idempotenc/i);
  });

  it("demands a lookup whenever the provider already has the transfer", () => {
    expect(decideTransferRetry({ status: "processing", providerTransferId: "tr_1" })).toMatchObject({
      action: "lookup_first",
    });
  });

  it("refuses to touch a completed transfer", () => {
    const decision = decideTransferRetry({ status: "completed", providerTransferId: "tr_1" });
    expect(decision.action).toBe("refuse");
    expect(decision.reason).toMatch(/twice/i);
  });

  it.each(["failed", "cancelled"] as const)("refuses to reuse a %s transfer's reference", (status) => {
    expect(decideTransferRetry({ status, providerTransferId: null })).toMatchObject({ action: "refuse" });
  });

  // The single property that matters: no path ever says "just send it again"
  // once anything has been sent.
  it("never says 'send' once anything has left", () => {
    const states = ["processing", "completed", "failed", "cancelled"] as const;
    for (const status of states) {
      for (const providerTransferId of [null, "tr_1"]) {
        expect(decideTransferRetry({ status, providerTransferId }).action).not.toBe("send");
      }
    }
  });
});

describe("canMarkSettlementSettled", () => {
  it("refuses without a provider transfer id", () => {
    const result = canMarkSettlementSettled({ status: "completed", providerTransferId: null, providerConfirmedStatus: "succeeded" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/no evidence/i);
  });

  // The core rule: asking for money to move is not evidence it moved.
  it("refuses when the provider has not confirmed success", () => {
    for (const providerConfirmedStatus of ["pending", "failed", null] as const) {
      const result = canMarkSettlementSettled({ status: "completed", providerTransferId: "tr_1", providerConfirmedStatus });
      expect(result.allowed).toBe(false);
    }
  });

  it("refuses when our own record is not completed", () => {
    expect(
      canMarkSettlementSettled({ status: "processing", providerTransferId: "tr_1", providerConfirmedStatus: "succeeded" }).allowed
    ).toBe(false);
  });

  it("allows only when the provider confirmed success AND our record agrees", () => {
    expect(
      canMarkSettlementSettled({ status: "completed", providerTransferId: "tr_1", providerConfirmedStatus: "succeeded" }).allowed
    ).toBe(true);
  });
});

describe("assertTransferExecutionAllowed", () => {
  it("throws while no provider has a verified transfer capability", () => {
    expect(() => assertTransferExecutionAllowed()).toThrow(/no verified transfer capability|no PayMongo wallet/i);
  });
});
