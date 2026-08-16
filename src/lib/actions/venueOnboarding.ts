"use server";

import { revalidatePath } from "next/cache";
import { getVenueForOwner, linkVenuePaymongoAccount } from "@/lib/services/venues";
import {
  createPayMongoMerchantAccount,
  createIdentityVerificationSession,
  activatePayMongoAccount,
} from "@/lib/services/paymongoAccounts";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Starts (or resumes) PayMongo Platforms onboarding for a venue the caller
 * owns, returning the hosted identity-verification URL to redirect the
 * owner to. Idempotent account reuse — mirrors the same gap the earlier
 * Stripe Connect design caught: clicking "Connect PayMongo" twice must
 * never create a second PayMongo account for the same venue. If the venue
 * already has a linked account, we skip straight to creating a fresh
 * identity-verification session for it instead of creating a new account.
 *
 * activate() is called immediately after starting verification, matching
 * PayMongo's documented 5-step flow (create → identity_verification →
 * update → activate → webhook) — this project skips the "update account"
 * step deliberately, since we collect no business/bank details ourselves
 * (PayMongo's hosted flow handles that), and TEST MODE's activate call
 * succeeded with an empty body. activate()'s own response is never
 * trusted for status (see paymongoAccounts.ts) — only the
 * merchant.activated/declined webhook updates paymongo_activation_status.
 */
export async function startPaymongoOnboardingAction(venueId: string): Promise<ActionResult<{ verificationUrl: string }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const venue = await getVenueForOwner(supabase, venueId);
    if (!venue) {
      return { success: false, error: "We couldn't find that venue." };
    }

    let paymongoAccountId = venue.paymongo_account_id;

    if (!paymongoAccountId) {
      const account = await createPayMongoMerchantAccount();
      const linked = await linkVenuePaymongoAccount(supabase, venueId, account.id);
      if (!linked) {
        return { success: false, error: "We couldn't link your venue to PayMongo — please try again." };
      }
      paymongoAccountId = account.id;
    }

    const verificationSession = await createIdentityVerificationSession(paymongoAccountId);
    await activatePayMongoAccount(paymongoAccountId);

    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: { verificationUrl: verificationSession.url } };
  } catch (error) {
    logServerError("venueOnboarding.startPaymongoOnboarding", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't start PayMongo onboarding.") };
  }
}
