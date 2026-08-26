"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import {
  recordPayoutTransfers,
  attestPayoutSent,
  attestPayoutSettled,
  attestPayoutFailed,
  cancelPayoutTransfer,
} from "@/lib/services/payoutAttestation";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * The manual payout flow's action layer.
 *
 * requireAdmin() here is a fast, friendly failure; each RPC re-checks
 * is_admin() in the database, which is the actual boundary (migration
 * 20260810000040).
 *
 * Nothing here moves money. `attestPayoutSettledAction` is the only one
 * with a consequence a venue owner sees — it settles their earnings and
 * emails them a payslip — and it is irreversible by design.
 */

const transferIdSchema = z.object({ transferId: z.uuid() });
const batchIdSchema = z.object({ batchId: z.uuid() });

/** Both attest-with-a-reason paths require a real reason, not whitespace. */
const reasonSchema = z.object({
  transferId: z.uuid(),
  reason: z.string().trim().min(1, "Please say why.").max(1000),
});

export async function recordPayoutTransfersAction(input: {
  batchId: string;
}): Promise<ActionResult<{ count: number }>> {
  const parsed = batchIdSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "Something went wrong. Please try again." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const rows = await recordPayoutTransfers(supabase, parsed.data.batchId);
    revalidatePath(`/admin/payouts/${parsed.data.batchId}`);
    return { success: true, data: { count: rows.length } };
  } catch (error) {
    logServerError("payoutAttestation.record", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(
        error,
        "We couldn't prepare the transfers.",
      ),
    };
  }
}

export async function attestPayoutSentAction(input: {
  transferId: string;
  batchId: string;
  providerReference?: string;
}): Promise<ActionResult<null>> {
  const parsed = transferIdSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "Something went wrong. Please try again." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    await attestPayoutSent(
      supabase,
      parsed.data.transferId,
      input.providerReference,
    );
    revalidatePath(`/admin/payouts/${input.batchId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("payoutAttestation.sent", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "We couldn't record that."),
    };
  }
}

/**
 * The irreversible one. Settles the venue's earnings and emails them a
 * payslip, both in the same database transaction as the attestation.
 *
 * A provider reference is required rather than optional: this is the only
 * durable link between our record and PayMongo's, and it is what makes a
 * later "did this actually go out?" answerable.
 */
export async function attestPayoutSettledAction(input: {
  transferId: string;
  batchId: string;
  providerReference: string;
}): Promise<ActionResult<null>> {
  const parsed = z
    .object({
      transferId: z.uuid(),
      providerReference: z
        .string()
        .trim()
        .min(1, "Enter PayMongo's reference for this transfer."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Something went wrong.",
    };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    await attestPayoutSettled(
      supabase,
      parsed.data.transferId,
      parsed.data.providerReference,
    );
    revalidatePath(`/admin/payouts/${input.batchId}`);
    revalidatePath("/admin/finance");
    return { success: true, data: null };
  } catch (error) {
    logServerError("payoutAttestation.settled", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "We couldn't record that."),
    };
  }
}

export async function attestPayoutFailedAction(input: {
  transferId: string;
  batchId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please say why.",
    };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    await attestPayoutFailed(
      supabase,
      parsed.data.transferId,
      parsed.data.reason,
    );
    revalidatePath(`/admin/payouts/${input.batchId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("payoutAttestation.failed", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "We couldn't record that."),
    };
  }
}

export async function cancelPayoutTransferAction(input: {
  transferId: string;
  batchId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please say why.",
    };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    await cancelPayoutTransfer(
      supabase,
      parsed.data.transferId,
      parsed.data.reason,
    );
    revalidatePath(`/admin/payouts/${input.batchId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("payoutAttestation.cancel", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "We couldn't cancel that."),
    };
  }
}
