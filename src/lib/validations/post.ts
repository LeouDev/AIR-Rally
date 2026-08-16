import { z } from "zod";

export const createPostSchema = z.object({
  content: z.string().trim().min(1, "Say something first.").max(280),
  imageUrl: z.string().trim().url().optional(),
});
export type CreatePostValues = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  postId: z.uuid(),
  content: z.string().trim().min(1, "Say something first.").max(280),
});
export type CreateCommentValues = z.infer<typeof createCommentSchema>;
