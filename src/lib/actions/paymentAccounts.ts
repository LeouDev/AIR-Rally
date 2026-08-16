"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/services/admin";
import { setVenuePaymentAccountStatus } from "@/lib/services/venuePaymentAccounts";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Admin control over whether a venue may be paid.
 *
 * `not_connected` and `pending_verification` are deliberately not settable:
 * they describe what PayMongo reports, and are maintained by the mirror
 * trigger. Letting an admin assert them would put two writers on the same
 * fact. The database rejects them too — this schema is the fast failure,
 * not the boundary.
 */
const setStatusSchema = z.object({
  venueId: z.uuid(),
  status: z.enum(["verified", "restricted", "disabled"]),
  reason: z.string().trim().max(300).optional(),
});

export async function setPaymentAccountStatusAction(input: {
  venueId: string;
  status: "verified" | "restricted" | "disabled";
  reason?: string;
}): Promise<ActionResult<{ updated: boolean }>> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "That payment account update doesn't look right." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const updated = await setVenuePaymentAccountStatus(supabase, parsed.data.venueId, parsed.data.status, parsed.data.reason);
    if (!updated) return { success: false, error: "We couldn't find a payment account for that venue." };

    revalidatePath("/admin/payment-accounts");
    revalidatePath("/admin/finance");
    return { success: true, data: { updated } };
  } catch (error) {
    logServerError("paymentAccounts.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that payment account.") };
  }
}
