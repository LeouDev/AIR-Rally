"use server";

import { revalidatePath } from "next/cache";
import { adminAdjustCredit } from "@/lib/services/credits";
import { requireAdmin } from "@/lib/services/admin";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * The layer that was missing. addCredit()/deductCredit() have existed and
 * been tested since 20260810000036, but nothing in the application could
 * reach them — correcting a balance meant hand-editing a financial table
 * in production.
 *
 * WHERE THE AUTHORISATION ACTUALLY IS
 *
 * In the database. admin_adjust_credit() is SECURITY DEFINER and calls
 * is_admin() on the caller, so a non-admin invoking this server action
 * directly — which anyone can attempt, server actions are public
 * endpoints — is refused by Postgres, not by this file.
 *
 * requireAdmin() below is a fast, friendly failure, NOT the enforcement.
 * The same posture as setVenueStatusAdminAction and refundBookingAction.
 * If this check were deleted the action would still be safe; if the RPC's
 * check were deleted it would not.
 *
 * The caller's own RLS-scoped client is passed through deliberately. The
 * service-role client used elsewhere in credits.ts carries no auth.uid(),
 * so is_admin() is false inside the RPC and the call fails closed.
 */

/** Positive grants, negative deducts. Integer minor units (centavos), matching commission.ts and bookingFee.ts. */
export async function adjustUserCreditAction(input: {
  userId: string;
  amount: number;
  reason: string;
}): Promise<ActionResult<{ balance: number }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) {
    return { success: false, error: adminCheck.error };
  }

  // Validated here for a usable message, and again in the RPC because this
  // check is skippable and that one is not.
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    return { success: false, error: "Enter an amount, in whole centavos, that isn't zero." };
  }
  if (!input.reason.trim()) {
    return { success: false, error: "Give a reason for this adjustment — it's the only record of why the balance changed." };
  }

  try {
    const balance = await adminAdjustCredit(supabase, {
      userId: input.userId,
      amount: input.amount,
      reason: input.reason,
    });

    revalidatePath("/admin/credits");
    revalidatePath(`/admin/credits/${input.userId}`);
    return { success: true, data: { balance } };
  } catch (error) {
    logServerError("credits.adminAdjust", error);
    // The RPC raises for insufficient privilege, a zero amount, a blank
    // reason, and a deduction below zero. getFriendlyErrorMessage keeps
    // the Postgres detail out of the browser while the log above keeps it
    // for us.
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't adjust that balance.") };
  }
}
