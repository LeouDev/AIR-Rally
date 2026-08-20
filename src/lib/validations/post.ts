import { z } from "zod";

export const createPostSchema = z.object({
  /** Storage paths, capped at 5 to match the posts_image_paths_max_5 CHECK. */
  imagePaths: z.array(z.string().max(500)).max(5).optional(),
  content: z.string().trim().min(1, "Say something first.").max(280),
  imageUrl: z.string().trim().url().optional(),
  /** Set to embed a joinable match card — "share this game" into COURT/Side. */
  eventId: z.uuid().optional(),
});
export type CreatePostValues = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  postId: z.uuid(),
  content: z.string().trim().min(1, "Say something first.").max(280),
});
export type CreateCommentValues = z.infer<typeof createCommentSchema>;
