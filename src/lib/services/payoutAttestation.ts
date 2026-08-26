import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PayoutTransfer } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * The manual payout flow — recording that a human sent money.
 *
 * EVERY FUNCTION HERE RECORDS AN ATTESTATION, NOT A CONFIRMATION. Nothing
 * on this path verifies that money moved; PayMongo offers no callback for a
 * dashboard upload, which is why it is manual in the first place. What gets
 * stored is that a named admin, at a named time, said they did something.
 * The naming reflects that deliberately — see migration 20260810000092.
 *
 * Authorisation is the database's. Each RPC re-checks is_admin() itself
 * (the lesson of migration 20260810000040), so the admin gate in the action
 * layer is a fast, friendly failure rather than the boundary.
 */

/**
 * Creates one transfer row per venue in an approved batch, if they do not
 * exist yet. Idempotent: a second call returns the same rows rather than
 * duplicating or erroring.
 *
 * Deliberately an explicit action rather than something a page does on
 * load — it writes rows, and a refresh, a link preload or a back-button
 * should never be a write.
 */
export async function recordPayoutTransfers(
  supabase: Client,
  batchId: string,
): Promise<PayoutTransfer[]> {
  const { data, error } = await supabase.rpc("record_payout_transfers", {
    p_batch_id: batchId,
  });
  if (error) throw error;
  return (data ?? []) as PayoutTransfer[];
}

/** "I uploaded this transfer to PayMongo." Announces nothing to the venue. */
export async function attestPayoutSent(
  supabase: Client,
  transferId: string,
  providerReference?: string,
): Promise<PayoutTransfer> {
  const { data, error } = await supabase.rpc("attest_payout_sent", {
    p_transfer_id: transferId,
    p_provider_reference: providerReference?.trim() || null,
  });
  if (error) throw error;
  return data as PayoutTransfer;
}

/**
 * "PayMongo's report shows this went out."
 *
 * The consequential one: it settles the venue's earnings and notifies them,
 * both in the same database transaction as the attestation itself. There is
 * no undo.
 */
export async function attestPayoutSettled(
  supabase: Client,
  transferId: string,
  providerReference: string,
): Promise<PayoutTransfer> {
  const { data, error } = await supabase.rpc("attest_payout_settled", {
    p_transfer_id: transferId,
    p_provider_reference: providerReference.trim(),
  });
  if (error) throw error;
  return data as PayoutTransfer;
}

/** "This one failed at PayMongo." Settles nothing and announces nothing. */
export async function attestPayoutFailed(
  supabase: Client,
  transferId: string,
  reason: string,
): Promise<PayoutTransfer> {
  const { data, error } = await supabase.rpc("attest_payout_failed", {
    p_transfer_id: transferId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as PayoutTransfer;
}

/**
 * "I marked this uploaded by mistake — I had not uploaded it."
 *
 * NOT an undo of an upload. If the file genuinely reached PayMongo, the
 * transfer may still go out, and cancelling then re-recording would create
 * a second live transfer for the same venue and week. The database records
 * which state the cancellation came from precisely so that case is
 * answerable afterwards; the UI is what has to stop it happening.
 */
export async function cancelPayoutTransfer(
  supabase: Client,
  transferId: string,
  reason: string,
): Promise<PayoutTransfer> {
  const { data, error } = await supabase.rpc("cancel_payout_transfer", {
    p_transfer_id: transferId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as PayoutTransfer;
}
