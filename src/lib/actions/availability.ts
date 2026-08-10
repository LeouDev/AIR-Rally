"use server";

import { getAvailableSlots } from "@/lib/services/availability";
import { getAvailableSlotsSchema, type GetAvailableSlotsValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { AvailableSlot } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * No authentication required — availability is public marketplace
 * information, same visibility as the court/venue pages themselves (the
 * brief's own "unauthenticated users may view public availability").
 * Only booking creation and cancellation require a session.
 */
export async function getAvailableSlotsAction(values: GetAvailableSlotsValues): Promise<ActionResult<AvailableSlot[]>> {
  const parsed = getAvailableSlotsSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    const slots = await getAvailableSlots(supabase, parsed.data.courtId, parsed.data.localDate, parsed.data.durationMinutes);
    return { success: true, data: slots };
  } catch (error) {
    logServerError("availability.getSlots", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't load availability.") };
  }
}
