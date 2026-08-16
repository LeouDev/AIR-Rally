import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database, PublicProfile } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

/** Idempotent — following someone already followed is a no-op, not an error. The self-follow CHECK constraint is the real guard; this never bypasses it. */
export async function follow(supabase: Client, followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase.from("follows").insert({ follower_id: followerId, following_id: followingId });
  if (error && !isUniqueViolation(error)) throw error;
}

/** Idempotent — unfollowing someone not followed is a no-op, not an error. */
export async function unfollow(supabase: Client, followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase.from("follows").delete().eq("follower_id", followerId).eq("following_id", followingId);
  if (error) throw error;
}

/** Batched — one query for a whole set of candidate user ids, not one per card. */
export async function listFollowingIds(supabase: Client, followerId: string, candidateIds?: string[]): Promise<string[]> {
  let query = supabase.from("follows").select("following_id").eq("follower_id", followerId);
  if (candidateIds) {
    if (candidateIds.length === 0) return [];
    query = query.in("following_id", candidateIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => row.following_id);
}

export type FollowCounts = { followers: number; following: number };

/** `head: true` on both — Postgres never materializes the matching rows, just the counts. */
export async function getFollowCounts(supabase: Client, userId: string): Promise<FollowCounts> {
  const [followersResult, followingResult] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  if (followersResult.error) throw followersResult.error;
  if (followingResult.error) throw followingResult.error;
  return { followers: followersResult.count ?? 0, following: followingResult.count ?? 0 };
}

/**
 * Joins via `public_profiles`, not a `profiles` embed — same reasoning
 * as everywhere else this codebase resolves "whose id is this" for
 * someone other than the current viewer (see posts.ts's attachAuthors).
 */
async function attachProfiles(supabase: Client, ids: string[]): Promise<PublicProfile[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("public_profiles").select("*").in("id", ids);
  if (error) throw error;
  const byId = new Map(data.map((p) => [p.id, p]));
  // Preserve the caller's own ordering (most-recent-follow-first) rather
  // than whatever order the profiles table happens to return.
  return ids.map((id) => byId.get(id)).filter((p): p is PublicProfile => p !== undefined);
}

export async function listFollowerProfiles(supabase: Client, userId: string, limit = 50): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachProfiles(supabase, data.map((row) => row.follower_id));
}

export async function listFollowingProfiles(supabase: Client, userId: string, limit = 50): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachProfiles(supabase, data.map((row) => row.following_id));
}
