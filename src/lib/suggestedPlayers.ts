import type { FeedPost } from "@/lib/services/posts";
import type { PublicProfile } from "@/lib/supabase/types";

export type SuggestedPlayer = {
  profile: PublicProfile;
  /** How many of this player's posts appear in the feed page we read. */
  postCount: number;
};

/**
 * Who to suggest a brand-new user follows, derived from the feed they can
 * already see.
 *
 * The design asked for "Plays at Riverside · 3.1 km" under each name. That
 * was rejected on safety grounds, not just data grounds: broadcasting which
 * court a named person frequents, to the strangers this screen exists to
 * introduce them to, discloses where someone regularly is. So the only
 * secondary fact here is post count — something the user chose to publish by
 * posting.
 *
 * Derived entirely from a feed response already in hand. No per-candidate
 * lookup, so this cannot become an N+1 across the list, and it needs nothing
 * added to court_side_feed().
 */
export function suggestedPlayersFromFeed(
  posts: FeedPost[],
  { viewerId, alreadyFollowing = [], limit = 4 }: {
    viewerId: string;
    alreadyFollowing?: string[];
    limit?: number;
  }
): SuggestedPlayer[] {
  const following = new Set(alreadyFollowing);
  const byId = new Map<string, SuggestedPlayer>();

  for (const post of posts) {
    const profile = post.author;

    // Filter BEFORE counting, not after. `author` is null for an account
    // that no longer resolves through public_profiles, and a nameless
    // suggestion card would still occupy one of only four slots.
    if (!profile) continue;

    // The viewer's own posts are in the viewer's own feed. Suggesting
    // someone follow themselves is the kind of bug people screenshot, and
    // it only appears once they have posted — so it is absent from every
    // empty-account test.
    if (profile.id === viewerId) continue;

    if (following.has(profile.id)) continue;

    const existing = byId.get(profile.id);
    if (existing) {
      // Dedupe by id: a prolific poster would otherwise take several of
      // four slots on a screen whose whole job is showing four DIFFERENT
      // people. Their extra posts raise the count instead.
      existing.postCount += 1;
    } else {
      byId.set(profile.id, { profile, postCount: 1 });
    }
  }

  // Feed order is recency, which is the signal worth keeping — someone who
  // posted today is likelier to be worth following than someone ranked
  // higher by volume months ago. Insertion order preserves it.
  return Array.from(byId.values()).slice(0, limit);
}

/** "3 posts" / "1 post" — the only secondary fact these cards carry. */
export function postCountLabel(postCount: number): string {
  return `${postCount} post${postCount === 1 ? "" : "s"}`;
}
