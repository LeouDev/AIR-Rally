import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export async function listFavoriteVenueIds(supabase: Client, userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("favorites").select("venue_id").eq("user_id", userId);
  if (error) throw error;
  return data.map((row) => row.venue_id);
}

export async function isFavorite(supabase: Client, userId: string, venueId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("favorites")
    .select("venue_id")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Idempotent — favoriting something already favorited is a no-op, not an error. */
export async function addFavorite(supabase: Client, userId: string, venueId: string): Promise<void> {
  const { error } = await supabase.from("favorites").insert({ user_id: userId, venue_id: venueId });
  if (error && !isUniqueViolation(error)) throw error;
}

/** Idempotent — removing a favorite that isn't there is a no-op, not an error. */
export async function removeFavorite(supabase: Client, userId: string, venueId: string): Promise<void> {
  const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("venue_id", venueId);
  if (error) throw error;
}
