import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Amenity } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export async function listAmenities(supabase: Client): Promise<Amenity[]> {
  const { data, error } = await supabase.from("amenities").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function listAmenityIdsForVenue(supabase: Client, venueId: string): Promise<string[]> {
  const { data, error } = await supabase.from("venue_amenities").select("amenity_id").eq("venue_id", venueId);
  if (error) throw error;
  return data.map((row) => row.amenity_id);
}

/**
 * Replaces a venue's amenity links with exactly the given set. Delete-then-
 * insert rather than a diff — simpler, and both halves are scoped to the
 * same venue_id so RLS (owner-only, see
 * supabase/migrations/20260809000004_amenities.sql) protects the whole
 * operation the same way either approach would.
 */
export async function setVenueAmenities(supabase: Client, venueId: string, amenityIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from("venue_amenities").delete().eq("venue_id", venueId);
  if (deleteError) throw deleteError;

  if (amenityIds.length === 0) return;

  const { error: insertError } = await supabase
    .from("venue_amenities")
    .insert(amenityIds.map((amenityId) => ({ venue_id: venueId, amenity_id: amenityId })));
  if (insertError) throw insertError;
}
