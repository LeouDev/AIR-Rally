import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Court } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Not called by any page yet — see ARCHITECTURE.md on the mock-data ->
 * Supabase seam. Ready for when a venue's court list reads from Supabase.
 */
export async function listCourtsByVenue(supabase: Client, venueId: string): Promise<Court[]> {
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .eq("venue_id", venueId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}
