import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export const VENUE_IMAGES_BUCKET = "venue-images";

/**
 * Turns a `court_images.storage_path` into a fetchable URL. Pure URL
 * construction — no network call, safe to use in a Server or Client
 * Component. The bucket is public (see
 * supabase/migrations/20260809000009_venue_images_storage.sql), so this
 * always returns a usable URL; whether anything is actually stored at
 * that path is a separate question the caller decides by falling back to
 * the illustrated placeholder when a venue has no `court_images` rows at
 * all (see CourtSurface's `deterministicSurfaceColor`).
 */
export function getPublicImageUrl(supabase: Client, storagePath: string): string {
  return supabase.storage.from(VENUE_IMAGES_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
