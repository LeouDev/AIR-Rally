"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import { getPayoutBatchDetail, getPayoutSummaryForTransfer } from "@/lib/services/payouts";
import { renderPayoutPayslipEmail } from "@/lib/emails/payoutPayslipEmail";
import { sendEmail } from "@/lib/services/email";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Sends a payslip to the requesting ADMIN so they can see it in a real mail
 * client, without any of it having happened.
 *
 * WHY THIS EXISTS AT ALL. The only other way to see this email is to click
 * "confirm PayMongo sent this payment", and that is not a preview: it
 * settles the venue's earnings, notifies the owner, and writes an
 * attestation that PayMongo's report showed a transfer going out. Doing
 * that to look at an email would put a false record in the ledger and mark
 * settlements paid against money that never moved. The whole design rests
 * on `completed` meaning something; spending the first one on a fiction is
 * the wrong way to open that ledger.
 *
 * ONE TEMPLATE, ONE DATA SOURCE, TWO CALLERS. This calls exactly the same
 * getPayoutSummaryForTransfer() and renderPayoutPayslipEmail() the real
 * send does (the `payout_sent` branch of
 * /api/webhooks/notification-created) — see payoutPayslipEmail.ts's own
 * comment for why that's a rule, not a preference: the prior version of
 * this action rendered a template no real owner ever received, which is
 * exactly the defect this rewrite closes.
 *
 * REQUIRES A RECORDED TRANSFER. getPayoutSummaryForTransfer() reads from
 * payout_transfers, so there is nothing to preview until step 1 of the
 * payout routine (recording the transfer) has run for this venue — before
 * that, `getPayoutBatchDetail()`'s `transferId` is null and this returns a
 * clear error rather than fabricating figures from batch items alone.
 *
 * WHAT THIS WRITES: nothing. No notification row, no settlement change —
 * it reads existing rows and calls sendEmail directly, deliberately
 * bypassing the notification-row mechanism, because writing a row is
 * exactly the side effect being avoided.
 *
 * WHO IT REACHES: the requesting admin's own address, taken from their
 * session and never from a parameter. A preview that could be addressed
 * anywhere is a way to send a venue owner a payslip for a payout that did
 * not happen, which is worse than the problem it solves.
 *
 * The subject is prefixed so a preview can never be mistaken for the real
 * thing sitting in the same inbox.
 */

const schema = z.object({ batchId: z.uuid() });

export async function sendPayslipPreviewAction(input: {
  batchId: string;
}): Promise<ActionResult<{ to: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "Something went wrong. Please try again." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return {
      success: false,
      error: "Your account has no email address to send to.",
    };

  try {
    const detail = await getPayoutBatchDetail(supabase, parsed.data.batchId);
    if (!detail) return { success: false, error: "Batch not found." };

    // Preview the first venue in the batch — one email, one payslip, the
    // same shape a real one takes.
    const transfer = detail.transfers[0];
    if (!transfer)
      return { success: false, error: "This batch has no venues to preview." };
    if (!transfer.transferId)
      return {
        success: false,
        error: "Record this venue's transfer first, then preview.",
      };

    const summary = await getPayoutSummaryForTransfer(supabase, transfer.transferId);
    if (!summary)
      return {
        success: false,
        error: "Couldn't build a preview for this transfer — check its bank details and settlements.",
      };

    const html = renderPayoutPayslipEmail(summary);

    const sent = await sendEmail({
      to: user.email,
      subject: `[PREVIEW] Your AIR/Rally payout for ${summary.periodLabel}`,
      html,
    });
    if (!sent)
      return {
        success: false,
        error: "We couldn't send the preview. Check the email configuration.",
      };

    return { success: true, data: { to: user.email } };
  } catch (error) {
    logServerError("payslipPreview.send", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "We couldn't send the preview."),
    };
  }
}
