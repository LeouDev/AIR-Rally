import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, VenueMarketplaceRow } from "@/lib/supabase/types";
import { getPublicImageUrl } from "@/lib/services/images";
import { computeOpenStatus } from "@/lib/services/customerAvailability";
import type { VenueCardData } from "@/components/court/CourtCard";

type Client = SupabaseClient<Database>;

type CourtRow = { id: string; name: string; venue_id: string; surface_type: string | null };
type OperatingHoursRow = { venue_id: string; day_of_week: number; start_time: string; end_time: string; id: string; created_at: string; updated_at: string };

const MAX_THUMBNAILS_PER_CARD = 4;

/**
 * The single mapper every card-rendering surface (Explore, Featured,
 * Favorites) goes through — replaces three near-identical inline
 * mapping blocks. Batches three additional reads across the whole page
 * of venues at once (courts-first-then-children, same pattern as
 * listVenuesByOwnerWithSummary): active courts, their first photo each,
 * and operating hours for the open/closed badge. No per-card queries —
 * this stays proportional to one page load, not one query per venue.
 */
export async function toVenueCardData(supabase: Client, rows: VenueMarketplaceRow[]): Promise<VenueCardData[]> {
  if (rows.length === 0) return [];

  const venueIds = rows.map((r) => r.id);

  const { data: courts, error: courtsError } = await supabase
    .from("courts")
    .select("id, name, venue_id, surface_type")
    .eq("status", "active")
    .in("venue_id", venueIds);
  if (courtsError) throw courtsError;

  const courtsByVenue = new Map<string, CourtRow[]>();
  for (const court of courts ?? []) {
    const list = courtsByVenue.get(court.venue_id) ?? [];
    list.push(court);
    courtsByVenue.set(court.venue_id, list);
  }

  const courtIds = (courts ?? []).map((c) => c.id);
  const firstImagePathByCourtId = new Map<string, string>();
  if (courtIds.length > 0) {
    const { data: courtImages, error: imagesError } = await supabase
      .from("court_images")
      .select("court_id, storage_path, sort_order")
      .in("court_id", courtIds)
      .order("sort_order", { ascending: true });
    if (imagesError) throw imagesError;
    for (const image of courtImages ?? []) {
      if (image.court_id && !firstImagePathByCourtId.has(image.court_id)) {
        firstImagePathByCourtId.set(image.court_id, image.storage_path);
      }
    }
  }

  const { data: operatingHours, error: hoursError } = await supabase
    .from("venue_operating_hours")
    .select("id, venue_id, day_of_week, start_time, end_time, created_at, updated_at")
    .in("venue_id", venueIds);
  if (hoursError) throw hoursError;

  const hoursByVenue = new Map<string, OperatingHoursRow[]>();
  for (const row of operatingHours ?? []) {
    const list = hoursByVenue.get(row.venue_id) ?? [];
    list.push(row);
    hoursByVenue.set(row.venue_id, list);
  }

  return rows.map((venue) => {
    const venueCourts = courtsByVenue.get(venue.id) ?? [];
    return {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      indoorOutdoor: venue.indoor_outdoor,
      averageRating: venue.average_rating,
      reviewCount: venue.review_count,
      startingPrice: venue.starting_price,
      activeCourtCount: venue.active_court_count,
      coverImageUrl: venue.cover_image_path ? getPublicImageUrl(supabase, venue.cover_image_path) : null,
      courtThumbnails: venueCourts.slice(0, MAX_THUMBNAILS_PER_CARD).map((court) => {
        const path = firstImagePathByCourtId.get(court.id);
        return {
          id: court.id,
          imageUrl: path ? getPublicImageUrl(supabase, path) : null,
          surfaceType: court.surface_type,
        };
      }),
      openStatus: computeOpenStatus(hoursByVenue.get(venue.id) ?? [], venue.timezone),
    };
  });
}
