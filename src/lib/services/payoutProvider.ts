/**
 * The seam where a future payout rail plugs in.
 *
 * NOTHING IN THIS FILE OR ITS PROVIDERS MOVES MONEY. Every method throws.
 * That is the design, not an unfinished state: an interface whose methods
 * silently returned a plausible-looking result would be far more dangerous
 * than one that refuses, because a caller written against it would appear
 * to work while paying nobody.
 *
 * Why this exists before any implementation:
 *   * it fixes the vocabulary (transfer, status, cancel) while the
 *     financial model is still being shaped, rather than after
 *   * it keeps PayMongo specifics out of the payout batch code, so the
 *     batch layer never learns provider details it would have to unlearn
 *   * it makes "no payout executor exists" a checkable fact — see
 *     assertNoPayoutExecutor() below and its test
 */

/** Integer minor units throughout, matching the settlement ledger. */
export type TransferRequest = {
  /** The batch this transfer settles, for idempotency and audit. */
  payoutBatchId: string;
  venueId: string;
  /** The provider-side merchant account receiving the money. */
  providerAccountId: string;
  amount: number;
  currency: string;
  /** Stable key so a retried transfer cannot pay twice. */
  idempotencyKey: string;
};

export type TransferResult = {
  providerTransferId: string;
  status: TransferStatus;
};

/**
 * PayMongo's own transfer vocabulary is only pending / succeeded / failed —
 * verified against docs/reference (August 2026). `cancelled` is AIR/Rally's
 * own state for a transfer we abandoned before sending; PayMongo has no
 * cancellation endpoint at all.
 */
export type TransferStatus = "pending" | "succeeded" | "failed" | "cancelled";

/** A provider webhook, already signature-verified by the caller. */
export type TransferWebhookEvent = {
  type: string;
  providerTransferId: string | null;
  /** Our own reference_number, when the provider echoes it back. */
  referenceNumber: string | null;
  status: TransferStatus;
  failureReason: string | null;
  raw: unknown;
};

export interface PayoutProvider {
  readonly name: string;
  /** True only when this provider can genuinely move money. */
  readonly implemented: boolean;

  createTransfer(request: TransferRequest): Promise<TransferResult>;
  getTransferStatus(providerTransferId: string): Promise<TransferStatus>;
  cancelTransfer(providerTransferId: string): Promise<void>;

  /**
   * Looks a transfer up by OUR reference, not the provider's id.
   *
   * Added because of a concrete PayMongo finding: transfers have no
   * Idempotency-Key header, so after a timeout we may hold no provider id
   * at all. Without a way to ask "did my reference already go through?",
   * the only options would be to retry blindly (risking double payment) or
   * abandon the money. See docs/payments/paymongo-transfers.md.
   */
  findTransferByReference(referenceNumber: string): Promise<TransferResult | null>;

  /**
   * Normalises a provider webhook into the shape above. Keeping this on the
   * provider is what stops PayMongo's event names and payload shape from
   * leaking into the payout batch layer.
   */
  handleWebhookEvent(rawEvent: unknown): TransferWebhookEvent;
}

export class PayoutNotImplementedError extends Error {
  constructor(operation: string, provider: string) {
    super(
      `${provider} payouts are not implemented — ${operation} cannot run. No transfer capability has been verified with the provider; see docs/payments/payout-readiness.md.`
    );
    this.name = "PayoutNotImplementedError";
  }
}

let registeredProvider: PayoutProvider | null = null;

/** Resolves the configured payout provider. */
export function getPayoutProvider(): PayoutProvider {
  if (!registeredProvider) {
    // Imported lazily so the provider module has no import-time side
    // effects — nothing is constructed, and no client is configured, until
    // something actually asks for a provider.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { paymongoPayoutProvider } = require("./providers/paymongo") as typeof import("./providers/paymongo");
    registeredProvider = paymongoPayoutProvider;
  }
  return registeredProvider;
}

/**
 * The safety check the payout batch layer relies on: throws unless NO
 * provider can move money.
 *
 * Inverted deliberately. A future phase that implements transfers will make
 * this throw, which forces whoever does it to find every place that assumed
 * money could not move — rather than discovering those places when a real
 * peso goes somewhere unexpected.
 */
export function assertNoPayoutExecutor(): void {
  const provider = getPayoutProvider();
  if (provider.implemented) {
    throw new Error(
      `${provider.name} reports a working payout executor, but nothing in AIR/Rally is authorised to move money yet. Review every payout call site before enabling this.`
    );
  }
}
