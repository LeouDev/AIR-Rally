import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database, Post, PostComment, PublicProfile } from "@/lib/supabase/types";
import { POST_IMAGES_BUCKET } from "@/lib/services/postImages";
import { listEmbeddedEvents, type EmbeddedEvent } from "@/lib/services/events";
import { logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

/** `event` is populated whenever post.event_id is set — a post that
 * shared a match embeds a joinable card, everywhere a post renders. */
export type PostWithAuthor = Post & { author: PublicProfile | null; event?: EmbeddedEvent | null };

/** A row as court_side_feed() returns it: a post plus the two feed-ordering fields. */
type FeedRow = Post & { effective_at: string; resharer_id: string | null };

/**
 * A feed entry. `resharer` is non-null when this row is in the feed
 * because someone reshared it, and drives the "reshared by" line. The same
 * post can appear as both an original and a reshare — deliberately, see
 * the migration's note.
 */
export type FeedPost = PostWithAuthor & { effective_at: string; resharer_id: string | null; resharer: PublicProfile | null };
export type PostCommentWithAuthor = PostComment & { author: PublicProfile | null };

/** Attaches embedded event summaries to whichever rows carry an event_id — shared by listFeedPosts/listPostsByUser. */
async function attachEvents<T extends { event_id: string | null }>(
  supabase: Client,
  rows: T[]
): Promise<(T & { event: EmbeddedEvent | null })[]> {
  const eventIds = Array.from(new Set(rows.map((r) => r.event_id).filter((id): id is string => id !== null)));
  const eventsById = await listEmbeddedEvents(supabase, eventIds);
  return rows.map((row) => ({ ...row, event: row.event_id ? (eventsById.get(row.event_id) ?? null) : null }));
}

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

/**
 * The COURT/Side feed, via the court_side_feed() RPC (migration
 * 20260810000050) rather than a direct read of `posts`.
 *
 * The RPC unions posts with reshares so a reshare lifts a post back to the
 * top with attribution — before it, pressing reshare incremented a counter
 * and notified the author, and nothing else. It is SECURITY INVOKER, so
 * RLS still applies exactly as it did to the direct query.
 *
 * The cursor is `effective_at` (the post's own time, or the reshare's when
 * the row is a reshare) rather than `created_at`. That is invisible to
 * callers: it is still an ISO timestamp from the last row, so loadMore is
 * unchanged.
 */
export async function listFeedPosts(
  supabase: Client,
  { limit = FEED_PAGE_SIZE, cursor }: { limit?: number; cursor?: string } = {}
): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const { data, error } = await supabase.rpc("court_side_feed", {
    p_limit: limit,
    p_cursor: cursor ?? undefined,
  });
  if (error) throw error;

  const rows = (data ?? []) as FeedRow[];

  // Authors and resharers resolve in ONE query over the union of both id
  // sets, not two round-trips against the same view. They overlap heavily
  // in practice — a resharer is usually also an author somewhere on the
  // page — so the union is barely larger than either set alone, and with
  // the database a network hop away the second query cost far more than
  // the extra ids do.
  const authorIds = rows.map((r) => r.user_id);
  const resharerIds = rows.map((r) => r.resharer_id).filter((id): id is string => id !== null);
  const [profiles, rowsWithEvents] = await Promise.all([
    profilesByIds(supabase, [...authorIds, ...resharerIds]),
    attachEvents(supabase, rows),
  ]);

  const posts: FeedPost[] = rowsWithEvents.map((row) => ({
    ...row,
    author: profiles.get(row.user_id) ?? null,
    resharer: row.resharer_id ? (profiles.get(row.resharer_id) ?? null) : null,
  }));

  const nextCursor = rows.length === limit ? rows[rows.length - 1].effective_at : null;
  return { posts, nextCursor };
}

/** Looks up profiles by id, empty-safe. Same view-not-embeddable reason as attachAuthors. */
async function profilesByIds(supabase: Client, ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("public_profiles").select("*").in("id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id, p]));
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

  const [withAuthors, withEvents] = await Promise.all([attachAuthors(supabase, data), attachEvents(supabase, data)]);
  const eventById = new Map(withEvents.map((row) => [row.id, row.event]));
  const posts = withAuthors.map((row) => ({ ...row, event: eventById.get(row.id) ?? null }));
  const nextCursor = data.length === limit ? data[data.length - 1].created_at : null;
  return { posts, nextCursor };
}

export async function createPost(
  supabase: Client,
  userId: string,
  content: string,
  imageUrl?: string | null,
  imagePaths: string[] = [],
  eventId?: string | null
): Promise<Post> {
  const { data, error } = await supabase
    .from("posts")
    .insert({ user_id: userId, content, image_url: imageUrl ?? null, image_paths: imagePaths, event_id: eventId ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Deletes a post and its uploaded images. RLS scopes this to the caller's
 * own post (or an admin) — a mismatched id is a silent no-op, not an error.
 *
 * The storage objects have to be removed here rather than by a database
 * trigger: Supabase storage is not reachable from Postgres, so a trigger
 * on `posts` can cascade the rows but leaves every file behind forever.
 * Both delete paths — the author's own delete and AdminDeletePostButton —
 * already route through this function, so this is the one place that
 * covers both.
 *
 * ORDER MATTERS: the row is read for its paths and the files removed
 * BEFORE the row is deleted. The other order would lose the paths on any
 * failure between the two, leaving files no longer referenced by anything
 * and therefore impossible to find later.
 *
 * A storage failure is logged, not thrown. The user asked for the post to
 * be gone; leaving it visible because a file could not be removed would be
 * the wrong trade, and an orphaned object is recoverable while a post the
 * author believes they deleted is not.
 */
export async function deletePost(supabase: Client, postId: string): Promise<void> {
  const { data: post } = await supabase.from("posts").select("image_paths").eq("id", postId).maybeSingle();

  const paths = post?.image_paths ?? [];
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(POST_IMAGES_BUCKET).remove(paths);
    if (storageError) {
      logServerError("posts.deletePost.storage", storageError);
    }
  }

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

/** Idempotent — resharing something already reshared is a no-op, not an error. */
export async function resharePost(supabase: Client, userId: string, postId: string): Promise<void> {
  const { error } = await supabase.from("post_reshares").insert({ post_id: postId, user_id: userId });
  if (error && !isUniqueViolation(error)) throw error;
}

/** Idempotent — undoing a reshare that isn't there is a no-op, not an error. */
export async function unresharePost(supabase: Client, userId: string, postId: string): Promise<void> {
  const { error } = await supabase.from("post_reshares").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw error;
}

/** Batched, same shape as listLikedPostIds. */
export async function listResharedPostIds(supabase: Client, userId: string, postIds: string[]): Promise<string[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase.from("post_reshares").select("post_id").eq("user_id", userId).in("post_id", postIds);
  if (error) throw error;
  return (data ?? []).map((row) => row.post_id);
}

/**
 * Records who a post tagged, which is what makes a mention notifiable.
 * Ids come from the composer's picker rather than re-parsing the text,
 * because "@Lea" doesn't identify a person — two players can share a
 * first name. Self-mentions are dropped here as well as in the trigger.
 *
 * Best-effort: a failure to record mentions must not lose the post that
 * was already created, so the caller logs and moves on.
 */
export async function recordPostMentions(supabase: Client, postId: string, authorId: string, userIds: string[]): Promise<void> {
  const targets = Array.from(new Set(userIds)).filter((id) => id !== authorId);
  if (targets.length === 0) return;

  const { error } = await supabase
    .from("post_mentions")
    .insert(targets.map((userId) => ({ post_id: postId, user_id: userId })));
  if (error && !isUniqueViolation(error)) throw error;
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
