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

  // ONE round-trip for courts AND their images (court_images has a real FK
  // to courts, so PostgREST embeds it), issued in parallel with the hours
  // query, which only needs venueIds.
  //
  // This used to be three sequential queries: courts, then images keyed on
  // the returned court ids, then hours. With the database in Seoul and the
  // functions elsewhere, each hop cost a full round-trip — about 600ms on
  // an Explore page load for work that has no ordering requirement.
  const [courtsResult, hoursResult] = await Promise.all([
    supabase
      .from("courts")
      .select("id, name, venue_id, surface_type, court_images(storage_path, sort_order)")
      .eq("status", "active")
      .in("venue_id", venueIds),
    supabase
      .from("venue_operating_hours")
      .select("id, venue_id, day_of_week, start_time, end_time, created_at, updated_at")
      .in("venue_id", venueIds),
  ]);

  if (courtsResult.error) throw courtsResult.error;
  if (hoursResult.error) throw hoursResult.error;

  type CourtWithImages = CourtRow & { court_images?: { storage_path: string; sort_order: number | null }[] | null };
  // Cast through `unknown` because supabase-js resolves embeds from the
  // generated `Relationships` metadata, and this project's hand-written
  // Database type declares `Relationships: []` for every table (see the
  // TableDef helper in supabase/types.ts). PostgREST resolves the embed
  // from the real foreign key regardless — verified against staging, which
  // returns court_images nested exactly as typed here.
  const courts = (courtsResult.data ?? []) as unknown as CourtWithImages[];
  const operatingHours = hoursResult.data;

  const courtsByVenue = new Map<string, CourtRow[]>();
  const firstImagePathByCourtId = new Map<string, string>();
  for (const court of courts) {
    const list = courtsByVenue.get(court.venue_id) ?? [];
    list.push(court);
    courtsByVenue.set(court.venue_id, list);

    // The embed can't be ordered per-row, so pick the lowest sort_order
    // here rather than relying on the query's ordering.
    const images = court.court_images ?? [];
    if (images.length > 0) {
      const first = images.reduce((best, img) =>
        (img.sort_order ?? Number.MAX_SAFE_INTEGER) < (best.sort_order ?? Number.MAX_SAFE_INTEGER) ? img : best
      );
      firstImagePathByCourtId.set(court.id, first.storage_path);
    }
  }

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
      latitude: venue.latitude,
      longitude: venue.longitude,
    };
  });
}
