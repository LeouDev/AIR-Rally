"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import { getPayoutBatchDetail } from "@/lib/services/payouts";
import { localDateIn } from "@/lib/services/venueLocalPeriods";
import { buildPesonetCsv, PesonetExportError } from "@/lib/payouts/pesonetExport";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Builds the PESONet bulk-transfer file for an approved batch.
 *
 * WRITES NOTHING. Generating the file is not the payout — recording the
 * transfers (step 1) and attesting them (steps 3 and 4) are. This reads a
 * batch and returns text. Downloading it twice is harmless; that matters,
 * because an admin who loses the file must be able to get it again without
 * touching the ledger.
 *
 * REFUSES RATHER THAN DEGRADES. If any venue has a bank name PayMongo will
 * not accept, an amount below the bank-transfer floor, or missing details,
 * NO file is produced and every problem is listed at once. A file that
 * silently omits one venue is the worst outcome available here: the upload
 * succeeds, the admin believes everyone was paid, and one venue is simply
 * missing from a run nobody re-checks.
 */

const schema = z.object({ batchId: z.uuid() });

export async function exportPesonetCsvAction(input: {
  batchId: string;
}): Promise<ActionResult<{ filename: string; csv: string; rowCount: number; totalCentavos: number }>> {
  try {
    const { batchId } = schema.parse(input);
    await requireAdmin();

    const supabase = await getServerClient();
    const detail = await getPayoutBatchDetail(supabase, batchId);
    if (!detail) {
      return { ok: false, error: "That payout batch no longer exists." };
    }

    // Only venues still awaiting money. A venue already confirmed sent must
    // not appear in a second upload — that is how a double payment happens,
    // and PayMongo would have no way to know it was a repeat.
    const outstanding = detail.transfers.filter((t) => t.transferStatus !== "completed");

    if (outstanding.length === 0) {
      return {
        ok: false,
        error: "Every venue in this batch has already been confirmed as sent. There is nothing left to upload.",
      };
    }

    // Same period derivation as the page and the payslip, so the file, the
    // dialog and the email cannot disagree about which week this is.
    const bookingIds = detail.items.map((i) => i.bookingId).filter(Boolean);
    const { data: bookingRows } = bookingIds.length
      ? await supabase.from("bookings").select("start_time, courts(venues(timezone))").in("id", bookingIds)
      : { data: [] };
    type BookingTzRow = { start_time: string; courts: { venues: { timezone: string } | null } | null };
    const localDates = ((bookingRows ?? []) as unknown as BookingTzRow[]).map((b) =>
      localDateIn(new Date(b.start_time), b.courts?.venues?.timezone ?? "Asia/Manila"),
    );

    const result = buildPesonetCsv({
      batchReference: detail.batch.batch_reference,
      localDates,
      venues: outstanding.map((t) => ({
        venueId: t.venueId,
        venueName: t.venueName,
        amount: t.amount,
        bankName: t.bankName,
        bankAccountName: t.bankAccountName,
        bankAccountNumber: t.bankAccountNumber,
      })),
    });

    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof PesonetExportError) {
      // The problem list IS the message. Swallowing it into a generic
      // failure would leave the admin with nothing to act on.
      return { ok: false, error: error.message };
    }
    logServerError("exportPesonetCsvAction", error);
    return { ok: false, error: getFriendlyErrorMessage(error) };
  }
}
