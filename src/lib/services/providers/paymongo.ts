import {
  PayoutNotImplementedError,
  type PayoutProvider,
  type TransferRequest,
  type TransferResult,
  type TransferStatus,
  type TransferWebhookEvent,
} from "@/lib/services/payoutProvider";

/**
 * PayMongo payout provider — DELIBERATELY NOT IMPLEMENTED.
 *
 * Every method throws. No HTTP call is made from this file, no API key is
 * read, and nothing is imported from lib/services/paymongo.ts (the CHECKOUT
 * client), so there is no path by which requiring this module could reach
 * PayMongo at all.
 *
 * WHY IT IS NOT IMPLEMENTED — these are unresolved facts, not missing
 * effort:
 *
 *   1. NO VENUE CAN RECEIVE MONEY. A payout needs an activated PayMongo
 *      Platforms child merchant account. None exists; the marketplace
 *      split gate has stayed closed for exactly this reason.
 *
 *   2. THE TRANSFER API IS UNVERIFIED. Earlier phases confirmed PayMongo's
 *      checkout, split_payment and refund behaviour against the real test
 *      API. No equivalent verification exists for transfers or payouts —
 *      endpoint shape, idempotency semantics, failure modes, and
 *      settlement timing are all unconfirmed. Writing this against guessed
 *      shapes would produce code that looks finished and fails with real
 *      money.
 *
 *   3. PROCESSING FEES ARE UNMODELLED. PayMongo deducts its fee before
 *      funds land, so cash actually received is below the recorded
 *      paymongo_amount. Until that difference is measured, a transfer of
 *      the full venue_amount could overdraw the platform account.
 *
 *   4. THERE IS NO REVERSAL PATH. If a transfer is sent and then fails,
 *      nothing knows how to unwind a partially-paid batch.
 *
 * When these are resolved, implementing this class should be the ONLY
 * change needed on the provider side — the batch layer already speaks the
 * PayoutProvider interface. Note that flipping `implemented` to true will
 * make assertNoPayoutExecutor() throw, which is intentional: it forces a
 * review of every call site that currently assumes money cannot move.
 */
class PayMongoPayoutProvider implements PayoutProvider {
  readonly name = "PayMongo";
  readonly implemented = false;

  /**
   * FUTURE: create a transfer to a venue's child merchant account.
   *
   * When built, it must be idempotent on `request.idempotencyKey` —
   * retrying a transfer after a timeout must never pay twice, and a
   * timeout cannot be distinguished from a failure without it.
   */
  async createTransfer(request: TransferRequest): Promise<TransferResult> {
    // The request is named in the error so a caller sees exactly which
    // payout was refused, rather than a bare "not implemented".
    throw new PayoutNotImplementedError(`createTransfer for batch ${request.payoutBatchId}`, this.name);
  }

  /**
   * FUTURE: poll a transfer's state.
   *
   * This — not the response to createTransfer — must be what marks a
   * settlement 'settled', the same webhook-authoritative discipline the
   * booking payment flow already uses: the thing that confirms money moved
   * is never the request that asked for it.
   */
  async getTransferStatus(providerTransferId: string): Promise<TransferStatus> {
    throw new PayoutNotImplementedError(`getTransferStatus for ${providerTransferId}`, this.name);
  }

  /** FUTURE: cancel a transfer that has not yet been executed. */
  async cancelTransfer(providerTransferId: string): Promise<void> {
    throw new PayoutNotImplementedError(`cancelTransfer for ${providerTransferId}`, this.name);
  }

  /**
   * FUTURE: the pre-retry lookup by our own reference. Required because
   * PayMongo offers no Idempotency-Key for transfers — see
   * providers/paymongoTransfers.ts.
   */
  async findTransferByReference(referenceNumber: string): Promise<TransferResult | null> {
    throw new PayoutNotImplementedError(`findTransferByReference for ${referenceNumber}`, this.name);
  }

  /** FUTURE: normalise a provider webhook. Never parses a guessed shape. */
  handleWebhookEvent(rawEvent: unknown): TransferWebhookEvent {
    // The event type is echoed back so a caller can see WHICH event was
    // refused rather than a bare "not implemented".
    const type = typeof rawEvent === "object" && rawEvent !== null && "type" in rawEvent ? String(rawEvent.type) : "unknown";
    throw new PayoutNotImplementedError(`handleWebhookEvent for '${type}'`, this.name);
  }
}

export const paymongoPayoutProvider: PayoutProvider = new PayMongoPayoutProvider();
