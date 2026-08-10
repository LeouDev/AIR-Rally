"use server";

import { revalidatePath } from "next/cache";
import { createCourt, updateCourt, setCourtStatus } from "@/lib/services/courts";
import { createCourtSchema, updateCourtSchema, type CreateCourtValues, type UpdateCourtValues } from "@/lib/validations/court";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Court } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Same pattern as updateVenueAction: `venueId` here is what RLS checks
 * (courts insert policy requires the venue to belong to auth.uid()) — no
 * app-level ownership check needed, the database is the boundary.
 */
export async function createCourtAction(venueId: string, values: CreateCourtValues): Promise<ActionResult<Court>> {
  const parsed = createCourtSchema.safeParse(values);
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
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const court = await createCourt(supabase, venueId, parsed.data);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: court };
  } catch (error) {
    logServerError("court.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't add that court.") };
  }
}

export async function updateCourtAction(
  venueId: string,
  courtId: string,
  values: UpdateCourtValues
): Promise<ActionResult<Court>> {
  const parsed = updateCourtSchema.safeParse(values);
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
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const court = await updateCourt(supabase, courtId, parsed.data);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: court };
  } catch (error) {
    logServerError("court.update", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save that court.") };
  }
}

export async function setCourtStatusAction(
  venueId: string,
  courtId: string,
  status: Court["status"]
): Promise<ActionResult<Court>> {
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
    const court = await setCourtStatus(supabase, courtId, status);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: court };
  } catch (error) {
    logServerError("court.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that court.") };
  }
}
