"use server";

import { revalidatePath } from "next/cache";
import { updateVenueBankDetails } from "@/lib/services/venuePaymentAccounts";
import { bankDetailsSchema, type BankDetailsValues } from "@/lib/validations/bankDetails";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Saves where a venue's earnings should be sent.
 *
 * No ownership check here, deliberately: the UPDATE policy added in
 * migration 20260810000053 only matches rows whose venue belongs to the
 * caller, so a venue id they do not own updates nothing rather than
 * raising. The column-level GRANT means only bank fields can move, and
 * the guard trigger reverts status and account id regardless.
 *
 * Nothing is logged from `values` on failure — these are bank
 * credentials, and an account number in a server log is exactly the kind
 * of leak that outlives the incident that caused it.
 */
export async function updateBankDetailsAction(
  venueId: string,
  values: BankDetailsValues
): Promise<ActionResult<null>> {
  const parsed = bankDetailsSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Please check the details and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to update your payout details." };

  try {
    await updateVenueBankDetails(supabase, venueId, {
      bankName: parsed.data.bankName,
      bankAccountName: parsed.data.bankAccountName,
      bankAccountNumber: parsed.data.bankAccountNumber,
    });
    revalidatePath("/list-your-court/settings");
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("bankDetails.update", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}
