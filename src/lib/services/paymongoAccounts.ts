import { PayMongoError, getSecretKey } from "@/lib/services/paymongo";
import { logServerError } from "@/lib/errors";

/**
 * PayMongo's Platforms/FIaaS Accounts API — v2, distinct from the v1 base
 * used by the plain (non-marketplace) Checkout Session/webhook flow in
 * paymongo.ts. Endpoints and field names below are all confirmed against
 * real, live TEST MODE API responses during this project's Platforms
 * research pass (see ARCHITECTURE.md) — nothing here is guessed.
 */
const PAYMONGO_ACCOUNTS_API_BASE = "https://api.paymongo.com/v2";

async function paymongoAccountsRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const secretKey = getSecretKey();
  const response = await fetch(`${PAYMONGO_ACCOUNTS_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json()) as { data?: T; errors?: Array<{ code: string; detail: string }> };
  if (!response.ok) {
    throw new Error(json.errors?.[0]?.detail ?? `PayMongo Accounts API returned ${response.status}`);
  }
  return json.data as T;
}

export type PayMongoAccount = {
  id: string;
  type: "merchant" | "consumer";
  activation_status: "pending" | "under_review" | "activated" | "declined";
};

/**
 * Creates a PayMongo Platforms child ("merchant") account for a venue.
 * Confirmed live: `POST /v2/accounts` with a flat `{"type":"merchant"}`
 * body (not nested under `data.attributes` — a real 400 with a `/type`
 * pointer confirmed the flat shape) returns `201` with a real `org_...`
 * id and `activation_status: "pending"`.
 *
 * We do not collect or store any KYC/business/bank details ourselves —
 * PayMongo's own hosted identity-verification flow (see
 * createIdentityVerificationSession below) is what gathers that, per this
 * project's explicit instruction never to store identity/bank documents
 * in our own database.
 */
export async function createPayMongoMerchantAccount(): Promise<PayMongoAccount> {
  try {
    return await paymongoAccountsRequest<PayMongoAccount>("/accounts", {
      method: "POST",
      body: { type: "merchant" },
    });
  } catch (error) {
    logServerError("paymongoAccounts.createMerchantAccount", error);
    throw new PayMongoError("account_onboarding_failed", "We couldn't start PayMongo onboarding — please try again.");
  }
}

export type PayMongoIdentityVerificationSession = {
  id: string;
  account_id: string;
  /**
   * Confirmed live field name is `url`, not `hosted_url` — a docs
   * paraphrase suggested `hosted_url` for a live-mode example, but the
   * real TEST MODE response we received used `url`. Trusting the live
   * response over the paraphrase.
   */
  url: string;
  status: "pending" | "in_progress" | "completed";
};

/**
 * Starts a hosted identity-verification session for the venue owner (the
 * account's "representative"). Confirmed live: `POST
 * /v2/accounts/{id}/identity_verification` with an empty body returns a
 * real mock session with a redirect `url` in TEST MODE. The owner
 * completes this on PayMongo's own hosted page — we never see or store
 * the underlying identity documents.
 */
export async function createIdentityVerificationSession(paymongoAccountId: string): Promise<PayMongoIdentityVerificationSession> {
  try {
    return await paymongoAccountsRequest<PayMongoIdentityVerificationSession>(
      `/accounts/${paymongoAccountId}/identity_verification`,
      { method: "POST", body: {} }
    );
  } catch (error) {
    logServerError("paymongoAccounts.createIdentityVerificationSession", error);
    throw new PayMongoError("account_onboarding_failed", "We couldn't start identity verification — please try again.");
  }
}

/**
 * Requests activation/risk review for the account. Confirmed live: `POST
 * /v2/accounts/{id}/activate` returns `200` with the account's
 * `activation_status` claiming `"activated"` — but a follow-up `GET` on
 * the same account, even seconds later, still showed `"pending"`. Because
 * of that observed inconsistency, this function's return value is
 * deliberately NOT trusted or stored anywhere: it only confirms PayMongo
 * accepted the activation request. The real, authoritative status comes
 * only from the merchant.activated/merchant.declined webhook — see
 * sync_venue_paymongo_activation() and the webhook route.
 */
export async function activatePayMongoAccount(paymongoAccountId: string): Promise<void> {
  try {
    await paymongoAccountsRequest<PayMongoAccount>(`/accounts/${paymongoAccountId}/activate`, {
      method: "POST",
      body: {},
    });
  } catch (error) {
    logServerError("paymongoAccounts.activateAccount", error);
    throw new PayMongoError("account_onboarding_failed", "We couldn't request account activation — please try again.");
  }
}
