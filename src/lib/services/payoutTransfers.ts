import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PayoutTransfer, PayoutTransferStatus } from "@/lib/supabase/types";
import { getPayoutProvider } from "@/lib/services/payoutProvider";

type Client = SupabaseClient<Database>;

/**
 * Read side of transfer attempts, plus the retry rule.
 *
 * NOTHING HERE EXECUTES A TRANSFER. There is no write path at all: the
 * table has no INSERT/UPDATE policy for any client role, and the provider
 * adapter refuses every call. This module exists so an admin can SEE
 * attempts, and so the retry rule is written down and tested before it is
 * ever needed.
 */

export type PayoutTransferRow = PayoutTransfer & {
  venueName: string;
  batchReference: string;
};

export async function listPayoutTransfers(supabase: Client, status?: PayoutTransferStatus): Promise<PayoutTransferRow[]> {
  let query = supabase
    .from("payout_transfers")
    .select("*, venues(name), payout_batches(batch_reference)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query.limit(200);
  if (error) throw error;

  return ((data ?? []) as unknown as (PayoutTransfer & {
    venues: { name: string } | null;
    payout_batches: { batch_reference: string } | null;
  })[]).map((row) => ({
    ...row,
    venueName: row.venues?.name ?? "Unknown venue",
    batchReference: row.payout_batches?.batch_reference ?? "—",
  }));
}

export type RetryDecision =
  | { action: "send"; reason: string }
  | { action: "lookup_first"; reason: string }
  | { action: "refuse"; reason: string };

/**
 * Decides what may be done with a transfer that did not clearly succeed.
 *
 * This is pure, and it is the most important function in the payout system
 * that does not move money — because the wrong answer here pays a venue
 * twice.
 *
 * The rule turns on ONE question: can we prove whether the provider ever
 * saw our request?
 *
 *   * `provider_transfer_id` present → the request reached PayMongo. Never
 *     re-send; ask the provider what happened to it.
 *   * `provider_transfer_id` absent, status `processing` → we sent
 *     something and never got an answer. This is the timeout case, and the
 *     dangerous one. PayMongo publishes no Idempotency-Key for transfers
 *     and its own guide suggests retrying with a NEW reference — which
 *     would double-pay. So: look up our existing reference first, always.
 *   * `pending` with nothing sent → safe to send.
 *   * `completed` → never again.
 */
export function decideTransferRetry(transfer: {
  status: PayoutTransferStatus;
  providerTransferId: string | null;
}): RetryDecision {
  if (transfer.status === "completed") {
    return { action: "refuse", reason: "This transfer already completed. Re-sending would pay the venue twice." };
  }

  if (transfer.providerTransferId) {
    return {
      action: "lookup_first",
      reason: "The provider already has this transfer. Check its current status rather than sending another.",
    };
  }

  if (transfer.status === "processing") {
    return {
      action: "lookup_first",
      reason:
        "This transfer was sent but never confirmed, and we hold no provider id. Look the reference up before doing anything — PayMongo offers no idempotency key, so a blind retry could pay twice.",
    };
  }

  if (transfer.status === "failed" || transfer.status === "cancelled") {
    return {
      action: "refuse",
      reason: "Create a new transfer rather than reusing this one — its reference is spent.",
    };
  }

  return { action: "send", reason: "Nothing has been sent for this transfer yet." };
}

/**
 * The guard any future execution path must call first.
 *
 * Throws while the provider reports itself unimplemented, which is today
 * and stays true until a wallet exists and sandbox transfers have actually
 * run. Placed here, in the service, so it cannot be skipped by calling the
 * provider directly from somewhere new.
 */
export function assertTransferExecutionAllowed(): void {
  const provider = getPayoutProvider();
  if (!provider.implemented) {
    throw new Error(
      `Transfer execution is unavailable: ${provider.name} has no verified transfer capability. AIR/Rally has no PayMongo wallet, so no source account exists. See docs/payments/paymongo-transfers.md.`
    );
  }
}

/**
 * What a settlement needs before it may be called 'settled'.
 *
 * DESIGN ONLY — nothing calls this to actually settle anything.
 *
 * The rule that matters: a transfer's own creation response is NEVER
 * sufficient. Only a confirmed provider status is, exactly as booking
 * payments are confirmed by the webhook rather than by the checkout call
 * that started them. Asking for money to move is not evidence it moved.
 */
export function canMarkSettlementSettled(transfer: {
  status: PayoutTransferStatus;
  providerTransferId: string | null;
  providerConfirmedStatus: "pending" | "succeeded" | "failed" | null;
}): { allowed: boolean; reason: string } {
  if (!transfer.providerTransferId) {
    return { allowed: false, reason: "No provider transfer id — there is no evidence money moved." };
  }
  if (transfer.providerConfirmedStatus !== "succeeded") {
    return {
      allowed: false,
      reason: "The provider has not confirmed this transfer succeeded. A creation response is not confirmation.",
    };
  }
  if (transfer.status !== "completed") {
    return { allowed: false, reason: "The transfer record is not marked completed." };
  }
  return { allowed: true, reason: "The provider confirmed the transfer succeeded." };
}
