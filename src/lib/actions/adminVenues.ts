"use server";

import { revalidatePath } from "next/cache";
import { setVenueStatusAsAdmin } from "@/lib/services/venues";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { requireAdmin } from "@/lib/services/admin";
import type { Venue, VenueStatus } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Admin-only — approves a pending venue or suspends/reinstates an active
 * one. RLS's own venues UPDATE policy (owner or is_admin()) and the
 * venues_prevent_status_escalation trigger are the actual enforcement
 * (see setVenueStatusAsAdmin()'s own comment); requireAdmin() fails fast
 * with a clean message first, same posture as refundBookingAction and
 * deleteReviewAsAdminAction.
 */
export async function setVenueStatusAdminAction(
  venueId: string,
  status: Extract<VenueStatus, "active" | "suspended">
): Promise<ActionResult<Venue>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) {
    return { success: false, error: adminCheck.error };
  }

  try {
    const venue = await setVenueStatusAsAdmin(supabase, venueId, status);
    revalidatePath("/admin/venues");
    revalidatePath(`/admin/venues/${venueId}`);
    return { success: true, data: venue };
  } catch (error) {
    logServerError("adminVenues.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that venue.") };
  }
}
