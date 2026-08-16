import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listVenuesByOwner } from "@/lib/services/venues";

export const dynamic = "force-dynamic";

/**
 * Thin redirector, not a second calendar implementation — the calendar UI
 * stays canonical at `[venueId]/availability`. This tab exists so
 * "Calendar" has somewhere to link to without a venue already selected;
 * it just resolves which venue to show (an explicit `?venueId=` override,
 * or the owner's first venue) and redirects there.
 */
export default async function OwnerCalendarRedirectPage({ searchParams }: { searchParams: Promise<{ venueId?: string }> }) {
  const { venueId: requestedVenueId } = await searchParams;
  const user = await requireSignedIn("/list-your-court/calendar");
  const supabase = await createClient();
  const venues = await listVenuesByOwner(supabase, user.id);

  if (venues.length === 0) {
    redirect("/list-your-court");
  }

  const target = requestedVenueId && venues.some((v) => v.id === requestedVenueId) ? requestedVenueId : venues[0].id;
  redirect(`/list-your-court/${target}/availability`);
}
