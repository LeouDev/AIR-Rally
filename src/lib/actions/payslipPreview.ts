"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import { getPayoutBatchDetail } from "@/lib/services/payouts";
import { localDateIn, payoutPeriodFor } from "@/lib/services/venueLocalPeriods";
import { renderPayoutPayslipEmail } from "@/lib/emails/payoutPayslipEmail";
import { payoutTransferFeeCentavos } from "@/lib/payouts/transferFee";
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
 * WHAT THIS WRITES: nothing. No notification row, no transfer row, no
 * settlement change. It reads a batch, renders the same template the real
 * path renders, and calls sendEmail directly — deliberately bypassing the
 * notification-row mechanism, because writing a row is exactly the side
 * effect being avoided.
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

    const venueItems = detail.items.filter(
      (i) => i.venueId === transfer.venueId,
    );
    const bookingIds = venueItems.map((i) => i.bookingId).filter(Boolean);

    const { data: bookingRows } = bookingIds.length
      ? await supabase
          .from("bookings")
          .select("id, start_time, courts(name, venues(timezone))")
          .in("id", bookingIds)
      : { data: [] };

    type Row = {
      id: string;
      start_time: string;
      courts: { name: string; venues: { timezone: string } | null } | null;
    };
    const rows = (bookingRows ?? []) as unknown as Row[];
    const tz = rows[0]?.courts?.venues?.timezone ?? "Asia/Manila";
    const period = payoutPeriodFor(
      rows.map((r) => localDateIn(new Date(r.start_time), tz)),
    );

    const prettyDate = (ymd: string) => {
      const [y, m, d] = ymd.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
        timeZone: "UTC",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    };
    const weekLabel = period
      ? `${prettyDate(period.from)} – ${prettyDate(period.to)}`
      : "this period";

    const byBooking = new Map(rows.map((r) => [r.id, r]));
    // The settlement carries the commission, so line items come from the
    // batch's own settlements rather than being recomputed — the same
    // reason the real path fetches by batch: figures that reconcile with
    // the ledger by construction, not by two calculations agreeing.
    const { data: settlementRows } = await supabase
      .from("booking_settlements")
      .select("booking_id, gross_booking_amount, platform_fee, venue_amount")
      .in(
        "id",
        venueItems.map((i) => i.settlementId),
      );
    type SRow = {
      booking_id: string;
      gross_booking_amount: number;
      platform_fee: number;
      venue_amount: number;
    };
    const settlements = (settlementRows ?? []) as SRow[];

    const items = settlements.map((s) => {
      const booking = byBooking.get(s.booking_id);
      return {
        date: booking
          ? new Date(booking.start_time).toLocaleDateString("en-PH", {
              timeZone: tz,
              weekday: "short",
              day: "numeric",
              month: "short",
            })
          : "—",
        courtName: booking?.courts?.name ?? "Court",
        confirmationCode:
          venueItems.find((i) => i.bookingId === s.booking_id)
            ?.confirmationCode ?? "—",
        courtPrice: s.gross_booking_amount,
        earned: s.venue_amount,
      };
    });

    const totalCourtPrice = settlements.reduce(
      (sum, s) => sum + s.gross_booking_amount,
      0,
    );
    const totalCommission = settlements.reduce(
      (sum, s) => sum + s.platform_fee,
      0,
    );
    const totalEarned = settlements.reduce((sum, s) => sum + s.venue_amount, 0);
    const transferFee = payoutTransferFeeCentavos();

    const html = renderPayoutPayslipEmail({
      venueName: transfer.venueName,
      weekLabel,
      batchReference: detail.batch.batch_reference,
      items,
      totalCourtPrice,
      totalCommission,
      totalEarned,
      transferFee,
      amountTransferred: totalEarned - transferFee,
      link: "https://air-rally.com/list-your-court/earnings",
    });

    const sent = await sendEmail({
      to: user.email,
      subject: `[PREVIEW] Your AIR/Rally payout for ${weekLabel}`,
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
