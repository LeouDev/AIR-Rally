"use server";

import { revalidatePath } from "next/cache";
import { createCourtBlock, deleteCourtBlock } from "@/lib/services/courtBlocks";
import { createCourtBlockSchema, deleteCourtBlockSchema, type CreateCourtBlockValues } from "@/lib/validations/courtBlock";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { CourtBlockedPeriod } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * No explicit ownership check here — same posture as updateVenueAction:
 * court_blocked_periods' own INSERT RLS policy (see
 * supabase/migrations/20260810000003_court_blocked_periods.sql) requires
 * the caller to own the venue the target court belongs to. A block
 * attempt on a court the caller doesn't own matches zero rows and
 * surfaces as a normal "couldn't save" error, not a special case.
 */
export async function createCourtBlockAction(values: CreateCourtBlockValues): Promise<ActionResult<CourtBlockedPeriod>> {
  const parsed = createCourtBlockSchema.safeParse(values);
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
    return { success: false, error: "Sign in to block a court." };
  }

  try {
    const block = await createCourtBlock(supabase, user.id, {
      courtId: parsed.data.courtId,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/list-your-court/[venueId]/availability", "page");
    return { success: true, data: block };
  } catch (error) {
    logServerError("courtBlock.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't block that time.") };
  }
}

export async function deleteCourtBlockAction(blockId: string): Promise<ActionResult> {
  const parsed = deleteCourtBlockSchema.safeParse({ blockId });
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to remove a block." };
  }

  try {
    await deleteCourtBlock(supabase, parsed.data.blockId);
    revalidatePath("/list-your-court/[venueId]/availability", "page");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("courtBlock.delete", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't remove that block.") };
  }
}
