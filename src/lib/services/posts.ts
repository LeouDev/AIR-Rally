import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database, Post, PostComment, PublicProfile } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export type PostWithAuthor = Post & { author: PublicProfile | null };
export type PostCommentWithAuthor = PostComment & { author: PublicProfile | null };

const FEED_PAGE_SIZE = 20;

/**
 * Joins author display_name/avatar via `public_profiles`, not `profiles`
 * — same reasoning as `listReviewsByVenue`: an embed through `profiles`
 * would go through its own-row-only RLS and silently null out every
 * author who isn't the current viewer.
 */
async function attachAuthors<T extends { user_id: string }>(
  supabase: Client,
  rows: T[]
): Promise<(T & { author: PublicProfile | null })[]> {
  if (rows.length === 0) return [];
  const authorIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: authors, error } = await supabase.from("public_profiles").select("*").in("id", authorIds);
  if (error) throw error;
  const authorsById = new Map(authors.map((a) => [a.id, a]));
  return rows.map((row) => ({ ...row, author: authorsById.get(row.user_id) ?? null }));
}

/** Cursor-paginated by `created_at` (descending) — `cursor` is the last-seen row's `created_at`. */
export async function listFeedPosts(
  supabase: Client,
  { limit = FEED_PAGE_SIZE, cursor }: { limit?: number; cursor?: string } = {}
): Promise<{ posts: PostWithAuthor[]; nextCursor: string | null }> {
  let query = supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(limit);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const posts = await attachAuthors(supabase, data);
  const nextCursor = data.length === limit ? data[data.length - 1].created_at : null;
  return { posts, nextCursor };
}

/** One user's own COURT/Side history — backs the "My/Rally" profile page. Same cursor shape as listFeedPosts. */
export async function listPostsByUser(
  supabase: Client,
  userId: string,
  { limit = FEED_PAGE_SIZE, cursor }: { limit?: number; cursor?: string } = {}
): Promise<{ posts: PostWithAuthor[]; nextCursor: string | null }> {
  let query = supabase.from("posts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const posts = await attachAuthors(supabase, data);
  const nextCursor = data.length === limit ? data[data.length - 1].created_at : null;
  return { posts, nextCursor };
}

export async function createPost(supabase: Client, userId: string, content: string, imageUrl?: string | null): Promise<Post> {
  const { data, error } = await supabase
    .from("posts")
    .insert({ user_id: userId, content, image_url: imageUrl ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** RLS scopes this to the caller's own post (or an admin) — a mismatched id is a silent no-op, not an error. */
export async function deletePost(supabase: Client, postId: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throw error;
}

/** Idempotent — liking something already liked is a no-op, not an error. */
export async function likePost(supabase: Client, userId: string, postId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").insert({ post_id: postId, user_id: userId });
  if (error && !isUniqueViolation(error)) throw error;
}

/** Idempotent — unliking something not liked is a no-op, not an error. */
export async function unlikePost(supabase: Client, userId: string, postId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw error;
}

/** Batched — one query for the whole page of post ids, not one per card. */
export async function listLikedPostIds(supabase: Client, userId: string, postIds: string[]): Promise<string[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase.from("post_likes").select("post_id").eq("user_id", userId).in("post_id", postIds);
  if (error) throw error;
  return data.map((row) => row.post_id);
}

export async function listCommentsForPost(supabase: Client, postId: string): Promise<PostCommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return attachAuthors(supabase, data);
}

export async function createComment(supabase: Client, userId: string, postId: string, content: string): Promise<PostComment> {
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, user_id: userId, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** RLS scopes this to the caller's own comment (or an admin) — a mismatched id is a silent no-op, not an error. */
export async function deleteComment(supabase: Client, commentId: string): Promise<void> {
  const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
  if (error) throw error;
}
