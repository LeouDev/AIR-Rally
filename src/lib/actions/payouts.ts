"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import { createPayoutBatch, approvePayoutBatch, cancelPayoutBatch } from "@/lib/services/payouts";
import { validatePayoutBatch, getPayoutReadiness } from "@/lib/services/payoutReadiness";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Admin actions for preparing payouts. None of them move money.
 *
 * Every one calls requireAdmin() for a clean early failure, and every
 * underlying RPC re-checks is_admin() in the database — the lesson from
 * migration 040, where a SECURITY DEFINER function's own guard turned out
 * to be the only real boundary.
 */

const createBatchSchema = z.object({
  settlementIds: z.array(z.uuid()).min(1, "Select at least one settlement."),
  notes: z.string().trim().max(500).optional(),
});

const batchIdSchema = z.object({ batchId: z.uuid() });

export async function createPayoutBatchAction(input: {
  settlementIds: string[];
  notes?: string;
}): Promise<ActionResult<{ batchId: string }>> {
  const parsed = createBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Select at least one settlement." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    // Refuse to prepare a payout while the ledger disagrees with itself.
    // Affordability warnings are NOT a blocker — running a negative cash
    // position is a business decision, and blocking on it would push
    // admins to work around the check rather than read it.
    const readiness = await getPayoutReadiness(supabase);
    if (!readiness.ready) {
      return {
        success: false,
        error: `Payout preparation is blocked: ${readiness.blockers.length} unresolved reconciliation issue(s). Resolve them on the reconciliation page first.`,
      };
    }

    const validation = await validatePayoutBatch(supabase, parsed.data.settlementIds);
    if (!validation.valid) {
      const first = validation.rejected[0];
      return {
        success: false,
        error: first ? `Can't include that settlement — ${first.reason}` : "None of the selected settlements can be paid out.",
      };
    }

    const batchId = await createPayoutBatch(supabase, validation.eligible, parsed.data.notes);

    revalidatePath("/admin/payouts");
    revalidatePath("/admin/finance");
    return { success: true, data: { batchId } };
  } catch (error) {
    logServerError("payouts.createBatch", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't create that payout batch.") };
  }
}

/**
 * Approves a batch: draft/reviewing -> approved.
 *
 * This records a decision. It transfers nothing, and it leaves every
 * settlement in the batch at 'payable' — they only become 'settled' when a
 * venue has genuinely been paid, which no code here can do.
 */
export async function approvePayoutBatchAction(input: { batchId: string }): Promise<ActionResult<{ approved: boolean }>> {
  const parsed = batchIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "That payout batch doesn't look right." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const approved = await approvePayoutBatch(supabase, parsed.data.batchId);
    if (!approved) {
      return { success: false, error: "That batch can no longer be approved — it may already be approved, cancelled, or empty." };
    }

    revalidatePath("/admin/payouts");
    revalidatePath(`/admin/payouts/${parsed.data.batchId}`);
    return { success: true, data: { approved } };
  } catch (error) {
    logServerError("payouts.approveBatch", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't approve that payout batch.") };
  }
}

export async function cancelPayoutBatchAction(input: { batchId: string; reason?: string }): Promise<ActionResult<{ cancelled: boolean }>> {
  const parsed = batchIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "That payout batch doesn't look right." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const cancelled = await cancelPayoutBatch(supabase, parsed.data.batchId, input.reason);
    if (!cancelled) return { success: false, error: "That batch can no longer be cancelled." };

    revalidatePath("/admin/payouts");
    revalidatePath(`/admin/payouts/${parsed.data.batchId}`);
    return { success: true, data: { cancelled } };
  } catch (error) {
    logServerError("payouts.cancelBatch", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't cancel that payout batch.") };
  }
}
