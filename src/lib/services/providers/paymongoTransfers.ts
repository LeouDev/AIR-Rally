import {
  PayoutNotImplementedError,
  type PayoutProvider,
  type TransferRequest,
  type TransferResult,
  type TransferStatus,
  type TransferWebhookEvent,
} from "@/lib/services/payoutProvider";

/**
 * PayMongo transfer adapter — DISABLED BY DEFAULT, sandbox only.
 *
 * This is the first module in AIR/Rally that could, if enabled and given a
 * funded wallet, cause money to leave. Everything here is shaped around
 * that fact.
 *
 * ── WHAT THE RESEARCH FOUND (August 2026) ────────────────────────────────
 *
 * Verified live against AIR/Rally's own test key:
 *
 *   POST /v2/batch_transfers   → 400 {"code":"invalid_request_body",
 *                                    "detail":"transfers is required"}
 *     The route exists and our key is authorised for it.
 *
 *   GET  /v2/wallets/          → {"data":[]}
 *     AIR/Rally has NO wallet. A transfer needs a `source_account`, which
 *     comes from a wallet. This is the hard blocker: the API is reachable,
 *     the capability is not provisioned.
 *
 * Note the trailing slash: `/v2/batch_transfers/` answers 307 and
 * `/v2/wallets` answers 301. Paths here are written exactly as they must
 * be sent.
 *
 * ── THE IDEMPOTENCY PROBLEM ──────────────────────────────────────────────
 *
 * PayMongo documents NO Idempotency-Key header for transfers. Its own
 * money-movement guide tells you to use a NEW unique reference_number when
 * retrying — which is the opposite of idempotency, and would double-pay a
 * venue if the first attempt actually succeeded.
 *
 * AIR/Rally therefore does NOT rely on the provider for retry safety:
 *   * `reference_number` is generated once per payout_transfers row and is
 *     UNIQUE in our database
 *   * a retry must call findTransferByReference() FIRST
 *   * the same reference is re-sent, never regenerated
 *
 * ── WHY EVERY METHOD STILL THROWS ────────────────────────────────────────
 *
 * Even with the flag on, the calls below throw, because the request bodies
 * cannot be built: there is no wallet, so `source_account` has no value.
 * Writing a plausible-looking body against a shape we have never
 * successfully sent is exactly how payout code appears finished and fails
 * with real money. The flag exists so sandbox work can begin the moment a
 * wallet is provisioned — not to pretend that moment has arrived.
 */

/** Defaults to disabled. Only ever true with an explicit opt-in. */
export function isPaymongoTransfersEnabled(): boolean {
  return process.env.PAYMONGO_TRANSFERS_ENABLED === "true";
}

export class TransferNotEnabledError extends Error {
  constructor(operation: string) {
    super(
      `PayMongo transfers are disabled — ${operation} refused. Set PAYMONGO_TRANSFERS_ENABLED=true (sandbox only) to work on this, and note that AIR/Rally still has no PayMongo wallet to transfer from.`
    );
    this.name = "TransferNotEnabledError";
  }
}

/**
 * Refuses outright if the key is not a test key.
 *
 * The flag alone is not enough protection. Someone enabling transfers for
 * sandbox work while a live key happens to be configured is a realistic
 * mistake, and it is the one mistake here that spends real money.
 */
function assertSandboxCredentials(): void {
  const key = process.env.PAYMONGO_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test")) {
    throw new Error(
      "PayMongo transfers refused: PAYMONGO_SECRET_KEY is not a test key. Transfers are sandbox-only in this phase and must never run against live credentials."
    );
  }
}

/** Both guards, in the order that fails most cheaply first. */
function assertTransfersAllowed(operation: string): void {
  if (!isPaymongoTransfersEnabled()) {
    throw new TransferNotEnabledError(operation);
  }
  assertSandboxCredentials();
}

class PayMongoTransferProvider implements PayoutProvider {
  readonly name = "PayMongo Transfers";
  /**
   * Stays false until a real transfer has been executed end-to-end in
   * sandbox. Flipping this makes assertNoPayoutExecutor() throw, which is
   * deliberate — see lib/services/payoutProvider.ts.
   */
  readonly implemented = false;

  /**
   * FUTURE: POST /v2/batch_transfers
   *
   * Body shape, from PayMongo's reference:
   *   { transfers: [{ source_account: { number, name, bic },
   *                   destination_account: { number, name, bic },
   *                   amount, currency, provider, reference_number,
   *                   purpose, description, callback_url, metadata }] }
   *   provider ∈ paymongo | instapay | pesonet; bic "PAEYPHM2XXX" for PayMongo.
   *
   * Blocked on `source_account`: it comes from a wallet, and we have none.
   *
   * When built, the payout_transfers row must exist BEFORE this call, so a
   * crash mid-flight leaves a discoverable record rather than a silent
   * possible-payment.
   */
  async createTransfer(request: TransferRequest): Promise<TransferResult> {
    assertTransfersAllowed(`createTransfer for batch ${request.payoutBatchId}`);
    throw new PayoutNotImplementedError(
      `createTransfer for batch ${request.payoutBatchId} (no PayMongo wallet exists, so source_account cannot be built)`,
      this.name
    );
  }

  /** FUTURE: GET /v2/transfers/{id}. Statuses are pending | succeeded | failed. */
  async getTransferStatus(providerTransferId: string): Promise<TransferStatus> {
    assertTransfersAllowed(`getTransferStatus for ${providerTransferId}`);
    throw new PayoutNotImplementedError(`getTransferStatus for ${providerTransferId}`, this.name);
  }

  /**
   * PayMongo documents NO transfer cancellation. This will most likely stay
   * unimplemented permanently rather than becoming a real call — recorded
   * here so a future reader does not go looking for an endpoint that has
   * never existed.
   */
  async cancelTransfer(providerTransferId: string): Promise<void> {
    assertTransfersAllowed(`cancelTransfer for ${providerTransferId}`);
    throw new PayoutNotImplementedError(
      `cancelTransfer for ${providerTransferId} (PayMongo documents no cancellation endpoint)`,
      this.name
    );
  }

  /**
   * FUTURE: the pre-retry lookup, by our own reference_number.
   *
   * This is the single most important method for not double-paying, and
   * the one PayMongo's documented retry advice actively works against.
   * Likely implemented over GET /v2/transfers filtered by reference_number.
   */
  async findTransferByReference(referenceNumber: string): Promise<TransferResult | null> {
    assertTransfersAllowed(`findTransferByReference for ${referenceNumber}`);
    throw new PayoutNotImplementedError(`findTransferByReference for ${referenceNumber}`, this.name);
  }

  /**
   * FUTURE: normalise `payout.deposited` / `payout.returned`, and the
   * per-transfer `callback_url` payload, into TransferWebhookEvent.
   *
   * Deliberately NOT parsing a guessed shape today. A normaliser written
   * against an unverified payload would silently mis-map a failure to a
   * success, which is the worst possible direction for this particular
   * error to run in.
   */
  handleWebhookEvent(rawEvent: unknown): TransferWebhookEvent {
    // The event type is echoed back so a caller can see WHICH event was
    // refused rather than a bare "not implemented".
    const type = typeof rawEvent === "object" && rawEvent !== null && "type" in rawEvent ? String(rawEvent.type) : "unknown";
    throw new PayoutNotImplementedError(`handleWebhookEvent for '${type}'`, this.name);
  }
}

export const paymongoTransferProvider: PayoutProvider = new PayMongoTransferProvider();
