import { z } from "zod";

/** File type/size aren't Zod's job — a File isn't part of the JSON-ish
 * shape Zod validates elsewhere in this codebase. Those are enforced
 * client-side (see ImageUploadManager.tsx) and at the Storage bucket
 * level (see supabase/migrations/20260810000018_venue_images_bucket_limits.sql). */
export const deleteImageSchema = z.uuid();
