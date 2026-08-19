"use server";

import { revalidatePath } from "next/cache";
import { setVenueStatusAsAdmin } from "@/lib/services/venues";
import { getVenueReadiness } from "@/lib/services/venueReadiness";
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
 *
 * Activating a venue is additionally refused here unless
 * getVenueReadiness() reports every item complete — a live-site audit
 * found two production venues flipped to 'active', publicly listed with
 * a price and a working-looking booking widget, while carrying zero
 * venue_operating_hours rows. Per the availability model (see
 * ARCHITECTURE.md), a venue with no operating hours shows every day as
 * closed — it was never bookable, on any date, and nothing before this
 * stopped it from going live in that state. getVenueReadiness() already
 * modeled every one of these requirements correctly (it's the same
 * checklist the owner sees on their own dashboard); the gap was that
 * activation never actually consulted it.
 *
 * This is a fast, friendly pre-check, not the enforcement itself — same
 * posture as requireAdmin() below. There is no database-level guarantee
 * mirroring it (unlike requireAdmin, which RLS also enforces
 * independently), so this check is genuinely load-bearing: skip it and
 * an admin can activate an unready venue again. It is intentionally
 * re-checked here rather than trusted from whatever the admin UI last
 * rendered, since that could be stale by the time this action runs.
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
    if (status === "active") {
      // 'platform_approval' is excluded on purpose: that one readiness
      // item reports the venue's CURRENT status, so it can only read
      // "complete" once the venue is already active — checking it here,
      // before the activation this action performs, would make
      // activation impossible under any circumstance.
      const readiness = await getVenueReadiness(supabase, venueId);
      const blocking = readiness.items.filter(
        (item) => item.key !== "platform_approval" && item.status !== "complete" && item.status !== "not_applicable"
      );
      if (blocking.length > 0) {
        return {
          success: false,
          error: `This venue isn't ready to go live: ${blocking.map((item) => item.label.toLowerCase()).join(", ")} still ${blocking.length === 1 ? "needs" : "need"} to be completed first.`,
        };
      }
    }

    const venue = await setVenueStatusAsAdmin(supabase, venueId, status);
    revalidatePath("/admin/venues");
    revalidatePath(`/admin/venues/${venueId}`);
    return { success: true, data: venue };
  } catch (error) {
    logServerError("adminVenues.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that venue.") };
  }
}
