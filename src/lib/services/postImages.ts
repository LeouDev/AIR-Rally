import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export const POST_IMAGES_BUCKET = "post-images";

/** Enforced in three places: here, the composer UI, and a CHECK on posts.image_paths. */
export const MAX_POST_IMAGES = 5;

export const ALLOWED_POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Matches the bucket's own file_size_limit (5 MB) so the UI can reject early with a clear message. */
export const MAX_POST_IMAGE_BYTES = 5 * 1024 * 1024;

export type PostImageUploadResult = { paths: string[]; errors: string[] };

/**
 * Uploads composer images to `post-images/<user_id>/<random>`.
 *
 * The leading path segment must be the uploader's own id — the storage
 * INSERT policy keys on it, so a mismatched prefix is rejected by the
 * database rather than trusted from here.
 *
 * Partial success is deliberate: a post with 4 of 5 images still beats
 * losing the whole post, so failures are collected and returned for the
 * caller to surface rather than thrown.
 */
export async function uploadPostImages(supabase: Client, userId: string, files: File[]): Promise<PostImageUploadResult> {
  const paths: string[] = [];
  const errors: string[] = [];

  for (const file of files.slice(0, MAX_POST_IMAGES)) {
    if (!ALLOWED_POST_IMAGE_TYPES.includes(file.type)) {
      errors.push(`${file.name}: only JPEG, PNG, and WebP images are supported.`);
      continue;
    }
    if (file.size > MAX_POST_IMAGE_BYTES) {
      errors.push(`${file.name}: images must be 5 MB or smaller.`);
      continue;
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await supabase.storage.from(POST_IMAGES_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) errors.push(`${file.name}: upload failed.`);
    else paths.push(path);
  }

  return { paths, errors };
}

/** Resolves a stored path to its public URL for rendering. */
export function getPostImageUrl(supabase: Client, path: string): string {
  return supabase.storage.from(POST_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The same URL, without constructing a Supabase client.
 *
 * PostCard was calling getPostImageUrl(createClient(), path) inline —
 * building an entire Supabase client per image, per render, purely to
 * concatenate a string. In a scrolling feed with several photos per post
 * that is real work repeated for nothing. The bucket is public, so its
 * object URL is a fixed shape off the project URL. Mirrors
 * clubImagePublicUrl().
 *
 * Returns null rather than throwing when the env var is missing: a photo
 * that can't resolve should be skipped, never take the feed down.
 */
export function postImagePublicUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${POST_IMAGES_BUCKET}/${path}`;
}
