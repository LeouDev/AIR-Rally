"use server";

import { revalidatePath } from "next/cache";
import {
  createReport,
  resolveReport,
  createSupportRequest,
  setSupportRequestStatus,
  ReportError,
} from "@/lib/services/reports";
import {
  createReportSchema,
  resolveReportSchema,
  createSupportRequestSchema,
  type CreateReportValues,
  type ResolveReportValues,
  type CreateSupportRequestValues,
} from "@/lib/validations/report";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import { requireAdmin } from "@/lib/services/admin";
import type { Report, SupportRequest, SupportStatus } from "@/lib/supabase/types";

/**
 * Any signed-in account can report anything. There is deliberately no
 * check that the target exists: a post deleted between the reader opening
 * the dialog and submitting it should still record the report, and RLS on
 * the target table would hide some legitimate targets from the reporter
 * anyway. The moderation queue resolves the target at review time and
 * shows "no longer available" when it has gone.
 */
export async function createReportAction(values: CreateReportValues): Promise<ActionResult<Report>> {
  const parsed = createReportSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please pick a reason and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to report this." };

  try {
    const report = await createReport(supabase, user.id, parsed.data);
    return { success: true, data: report };
  } catch (error) {
    // Both of these are things the reporter can understand and act on, so
    // they get their own message rather than the generic fallback.
    if (error instanceof ReportError) {
      return { success: false, error: error.message };
    }
    logServerError("reports.create", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}

export async function resolveReportAction(values: ResolveReportValues): Promise<ActionResult<Report>> {
  const parsed = resolveReportSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Pick an outcome and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to do that." };

  try {
    // A fast, clear failure for a non-admin. The real boundary is the
    // reports UPDATE policy, which requires is_admin() — this check only
    // saves a round trip and produces a better message.
    await requireAdmin(supabase);
    const report = await resolveReport(supabase, parsed.data.reportId, user.id, parsed.data.status, parsed.data.note);
    revalidatePath("/admin/reports");
    revalidatePath("/admin");
    return { success: true, data: report };
  } catch (error) {
    logServerError("reports.resolve", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}

export async function createSupportRequestAction(
  values: CreateSupportRequestValues
): Promise<ActionResult<SupportRequest>> {
  const parsed = createSupportRequestSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to contact support." };

  try {
    const request = await createSupportRequest(supabase, user.id, parsed.data);
    revalidatePath("/support");
    return { success: true, data: request };
  } catch (error) {
    if (error instanceof ReportError) {
      return { success: false, error: error.message };
    }
    logServerError("support.create", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}

export async function setSupportRequestStatusAction(
  requestId: string,
  status: SupportStatus
): Promise<ActionResult<SupportRequest>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to do that." };

  try {
    await requireAdmin(supabase);
    const request = await setSupportRequestStatus(supabase, requestId, user.id, status);
    revalidatePath("/admin/support");
    return { success: true, data: request };
  } catch (error) {
    logServerError("support.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}
