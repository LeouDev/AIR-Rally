import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Review } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Not called by any page yet — review *submission* is deliberately not
 * built until reviews can be tied to a completed booking (see the brief),
 * and the reviews *list* on Court Details still reads mock data. This
 * exists so the RLS-backed table has a matching read function ready.
 */
export async function listReviewsByVenue(supabase: Client, venueId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
