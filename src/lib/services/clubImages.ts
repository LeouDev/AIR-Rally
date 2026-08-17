import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export const CLUB_IMAGES_BUCKET = "club-images";

export const ALLOWED_CLUB_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Matches the bucket's own file_size_limit (5 MB) so the UI can reject early with a clear message. */
export const MAX_CLUB_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Uploads a club photo to `club-images/<user_id>/<random>`.
 *
 * The leading path segment must be the uploader's own id — the storage
 * INSERT policy keys on it (migration 20260810000051), so a mismatched
 * prefix is rejected by the database rather than trusted from here.
 *
 * Unlike uploadPostImages this returns a single path or an error message,
 * because a club has one photo and there is no partial success to salvage.
 */
export async function uploadClubImage(
  supabase: Client,
  userId: string,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  if (!ALLOWED_CLUB_IMAGE_TYPES.includes(file.type)) {
    return { path: null, error: "Only JPEG, PNG, and WebP images are supported." };
  }
  if (file.size > MAX_CLUB_IMAGE_BYTES) {
    return { path: null, error: "Images must be 5 MB or smaller." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(CLUB_IMAGES_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) return { path: null, error: "Upload failed. Please try again." };
  return { path, error: null };
}

/** Resolves a stored path to its public URL for rendering. */
export function getClubImageUrl(supabase: Client, path: string): string {
  return supabase.storage.from(CLUB_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The same URL, without needing a Supabase client.
 *
 * ClubCard is a server component that receives only a `Club`, and
 * threading a client through it (or through every page that renders one)
 * to build a string is more plumbing than the string is worth. The bucket
 * is public, so its object URL is a fixed shape off the project URL.
 *
 * Returns null rather than throwing when the env var is absent, because
 * a missing photo must never take a page down.
 */
export function clubImagePublicUrl(path: string | null): string | null {
  if (!path) return null;
  // Tolerates a full URL already being stored, so this stays correct if a
  // club's photo ever comes from somewhere other than this bucket.
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${CLUB_IMAGES_BUCKET}/${path}`;
}
