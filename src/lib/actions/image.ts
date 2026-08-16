"use server";

import { revalidatePath } from "next/cache";
import { deleteCourtImage } from "@/lib/services/images";
import { deleteImageSchema } from "@/lib/validations/image";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * `venueId` is only used for revalidatePath, not sent to Supabase — RLS
 * on `court_images` (owner_id = auth.uid() via the venues join, see
 * supabase/migrations/20260809000005_court_images.sql) is what actually
 * enforces this can only delete an image belonging to the caller's own
 * venue.
 */
export async function deleteImageAction(imageId: string, venueId: string): Promise<ActionResult> {
  const parsed = deleteImageSchema.safeParse(imageId);
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
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    await deleteCourtImage(supabase, parsed.data);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("image.delete", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't remove that photo.") };
  }
}
