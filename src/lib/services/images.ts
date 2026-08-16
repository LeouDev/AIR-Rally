import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CourtImage } from "@/lib/supabase/types";

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

/**
 * `venue-images/<venueId>/<filename>` for a venue-level photo, or
 * `venue-images/<venueId>/courts/<courtId>/<filename>` for a court-level
 * one. Both forms have `<venueId>` as the first path segment, which is
 * all the storage RLS policies actually check (see
 * `(storage.foldername(name))[1]` in the migration above) — nesting
 * court photos one level deeper doesn't need a second bucket or a second
 * set of policies. Filenames are randomized to avoid collisions and to
 * strip anything that isn't a plain, safe path segment.
 */
export function buildImageStoragePath(venueId: string, courtId: string | null, filename: string): string {
  const safeName = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(-100);
  const unique = crypto.randomUUID();
  const folder = courtId ? `${venueId}/courts/${courtId}` : venueId;
  return `${folder}/${unique}-${safeName}`;
}

export type UploadCourtImageParams = {
  venueId: string;
  courtId: string | null;
  file: File;
  altText?: string | null;
  sortOrder?: number;
};

/**
 * Uploads the binary directly to Storage, then inserts the `court_images`
 * row that points at it — both against RLS-protected, owner-scoped
 * writes (see supabase/migrations/20260809000005_court_images.sql and
 * 20260809000009_venue_images_storage.sql), so this is safe to call with
 * either the browser client (the intended, normal caller — see
 * ImageUploadManager.tsx) or a server client. If the Storage upload
 * succeeds but the row insert fails, the file is left in Storage
 * unreferenced — harmless, cleanable later, and preferable to the
 * reverse (a DB row pointing at a file that was never actually written).
 */
export async function uploadCourtImage(supabase: Client, params: UploadCourtImageParams): Promise<CourtImage> {
  const storagePath = buildImageStoragePath(params.venueId, params.courtId, params.file.name);

  const { error: uploadError } = await supabase.storage
    .from(VENUE_IMAGES_BUCKET)
    .upload(storagePath, params.file, { contentType: params.file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabase
    .from("court_images")
    .insert({
      venue_id: params.venueId,
      court_id: params.courtId,
      storage_path: storagePath,
      alt_text: params.altText ?? null,
      sort_order: params.sortOrder ?? 0,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data;
}

/** Every photo for a venue — both venue-level (`court_id is null`) and
 * every court's — ordered so the lowest `sort_order` venue-level row is
 * always first (that's what "cover image" means, see
 * listVenuesByOwnerWithSummary() in venues.ts). Owner-only in practice:
 * RLS lets an owner read their own venue's images at any status, unlike
 * the public read path which requires `status = 'active'`. */
export async function listImagesForVenue(supabase: Client, venueId: string): Promise<CourtImage[]> {
  const { data, error } = await supabase
    .from("court_images")
    .select("*")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Deletes the `court_images` row first, then the underlying Storage
 * object. This ordering matters: if something fails between the two
 * steps, an orphaned Storage object is harmless (unreferenced, cleanable
 * later), while the reverse order risks a dangling DB row pointing at a
 * 404'd image, which would show as a broken photo in the UI. RLS on
 * `court_images` (owner-scoped) is what actually enforces this can only
 * delete an image belonging to the caller's own venue.
 */
export async function deleteCourtImage(supabase: Client, imageId: string): Promise<void> {
  const { data: row, error: deleteRowError } = await supabase
    .from("court_images")
    .delete()
    .eq("id", imageId)
    .select("storage_path")
    .single();
  if (deleteRowError) throw deleteRowError;

  const { error: removeObjectError } = await supabase.storage.from(VENUE_IMAGES_BUCKET).remove([row.storage_path]);
  if (removeObjectError) throw removeObjectError;
}
