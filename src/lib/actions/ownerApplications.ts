"use server";

import { revalidatePath } from "next/cache";
import {
  requestOwnerAccess,
  submitOwnerApplication,
  approveOwnerApplication,
  rejectOwnerApplication,
  OwnerApplicationError,
} from "@/lib/services/ownerApplications";
import { recordReferralStart, markReferralCompleted, markReferralApproved } from "@/lib/services/referrals";
import { submitOwnerApplicationSchema, type SubmitOwnerApplicationValues } from "@/lib/validations/ownerApplication";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { requireAdmin } from "@/lib/services/admin";
import type { OwnerApplication } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * "Request owner access" — the one self-service step in the whole
 * lifecycle (see prevent_owner_status_tampering()). A referral code, if
 * present, is resolved server-side to a referrer and recorded here,
 * never trusted as a client-supplied user id (Part 7).
 */
export async function requestOwnerAccessAction(referralCode?: string): Promise<ActionResult> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to apply as a venue owner." };
  }

  try {
    await requestOwnerAccess(supabase, user.id);
    if (referralCode) {
      await recordReferralStart(supabase, referralCode, user.id);
    }
    revalidatePath("/profile");
    revalidatePath("/owner/onboarding");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ownerApplications.requestAccess", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't start your owner application.") };
  }
}

export async function submitOwnerApplicationAction(
  values: SubmitOwnerApplicationValues
): Promise<ActionResult<OwnerApplication>> {
  const parsed = submitOwnerApplicationSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to submit your application." };
  }

  try {
    const application = await submitOwnerApplication(supabase, user.id, parsed.data);
    await markReferralCompleted(supabase, user.id);
    revalidatePath("/owner/onboarding");
    revalidatePath("/profile");
    return { success: true, data: application };
  } catch (error) {
    logServerError("ownerApplications.submit", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't submit your application.") };
  }
}

/**
 * Admin-only. RLS's own owner_applications UPDATE policy and
 * approveOwnerApplication()'s own doc comment are the actual
 * enforcement — requireAdmin() fails fast with a clean message first,
 * same posture as every other admin action in this codebase.
 */
export async function approveOwnerApplicationAction(applicationId: string): Promise<ActionResult<OwnerApplication>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) {
    return { success: false, error: adminCheck.error };
  }

  try {
    const application = await approveOwnerApplication(supabase, applicationId, adminCheck.userId);
    await markReferralApproved(supabase, application.user_id);
    revalidatePath("/admin/owner-applications");
    revalidatePath(`/admin/owner-applications/${applicationId}`);
    return { success: true, data: application };
  } catch (error) {
    // A missing payout destination is something the admin can act on —
    // chase the applicant for it — rather than a system failure, so it
    // says so instead of falling through to the generic message.
    if (error instanceof OwnerApplicationError) {
      return { success: false, error: error.message };
    }
    logServerError("ownerApplications.approve", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't approve that application.") };
  }
}

export async function rejectOwnerApplicationAction(applicationId: string): Promise<ActionResult<OwnerApplication>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) {
    return { success: false, error: adminCheck.error };
  }

  try {
    const application = await rejectOwnerApplication(supabase, applicationId, adminCheck.userId);
    revalidatePath("/admin/owner-applications");
    revalidatePath(`/admin/owner-applications/${applicationId}`);
    return { success: true, data: application };
  } catch (error) {
    logServerError("ownerApplications.reject", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't reject that application.") };
  }
}
