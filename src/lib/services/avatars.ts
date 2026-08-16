import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export const AVATAR_BUCKET = "avatars";

/**
 * Fixed, extension-less path per user — see
 * supabase/migrations/20260810000022_avatars_storage.sql. Content-type is
 * carried as upload metadata (`contentType`), not the filename, so
 * Storage still serves the right MIME type without needing the path to
 * change per upload.
 */
export function buildAvatarStoragePath(userId: string): string {
  return `${userId}/avatar`;
}

export function getAvatarPublicUrl(supabase: Client, userId: string): string {
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(buildAvatarStoragePath(userId)).data.publicUrl;
}

/**
 * Uploads directly to Storage (RLS on `storage.objects` already scopes
 * this to the caller's own `<user_id>/` folder — see the migration above),
 * `upsert: true` so re-uploading replaces the same object in place rather
 * than requiring a separate delete step. Returns the public URL; the
 * caller is responsible for persisting it onto `profiles.avatar_url` (see
 * updateAvatarAction in lib/actions/profile.ts) — this function only
 * touches Storage.
 */
export async function uploadAvatar(supabase: Client, userId: string, file: File): Promise<string> {
  const storagePath = buildAvatarStoragePath(userId);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  return getAvatarPublicUrl(supabase, userId);
}
