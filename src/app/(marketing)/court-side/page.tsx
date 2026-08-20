import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { CourtSideFeed } from "@/components/court-side/CourtSideFeed";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listFeedPosts, listLikedPostIds, listResharedPostIds } from "@/lib/services/posts";
import { listUpcomingEvents, listMyEventStatuses } from "@/lib/services/events";
import { listFollowingIds, getFollowCounts } from "@/lib/services/follows";
import { resolveClubMentionsForPosts } from "@/lib/services/clubs";

export const metadata = { title: "COURT/Side" };
// Renders per-user data (own profile, own like/follow/RSVP state via a
// cookie-scoped Supabase session) — must never be cached/shared across
// visitors like a static page would be.
export const dynamic = "force-dynamic";

export default async function CourtSidePage() {
  const session = await getCurrentUserWithProfile();

  if (!session) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={Users}
          title="Sign in to join COURT/Side"
          description="COURT/Side is AIR/Rally's community hub — share your games, connect with players, and find your next rally."
          action={
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/login?redirect=/court-side">Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/signup?redirect=/court-side">Create Account</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ posts, nextCursor }, events] = await Promise.all([listFeedPosts(supabase), listUpcomingEvents(supabase)]);

  const postIds = posts.map((p) => p.id);
  const postEventIds = posts.map((p) => p.event?.id).filter((id): id is string => id !== undefined && id !== null);
  // Covers both the "Happening Now" sidebar and any shared-game card a
  // post embeds — one status map serves both, keyed by event id.
  const eventIds = Array.from(new Set([...events.map((e) => e.id), ...postEventIds]));
  const authorIds = Array.from(new Set(posts.map((p) => p.user_id)));

  const [likedPostIds, resharedPostIds, followingIds, myEventStatuses, followCounts, clubMentions] = await Promise.all([
    listLikedPostIds(supabase, session.user.id, postIds),
    listResharedPostIds(supabase, session.user.id, postIds),
    listFollowingIds(supabase, session.user.id, authorIds),
    listMyEventStatuses(supabase, session.user.id, eventIds),
    getFollowCounts(supabase, session.user.id),
    resolveClubMentionsForPosts(
      supabase,
      posts.map((p) => p.content)
    ),
  ]);
  // Plain object, not a Map — this crosses the server→client component
  // boundary, and a Map doesn't survive serialization (same reason
  // ClubMentionMap is a Record in lib/services/clubs.ts).
  const initialEventStatuses = Object.fromEntries(myEventStatuses);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <CourtSideFeed
        currentUserId={session.user.id}
        displayName={session.profile?.display_name || session.user.email || "Player"}
        avatarUrl={session.profile?.avatar_url ?? null}
        isAdmin={session.profile?.role === "admin"}
        initialPosts={posts}
        initialNextCursor={nextCursor}
        initialLikedPostIds={likedPostIds}
        initialFollowingIds={followingIds}
        initialEvents={events}
        initialEventStatuses={initialEventStatuses}
        initialFollowerCount={followCounts.followers}
        initialFollowingCount={followCounts.following}
        initialResharedPostIds={resharedPostIds}
        clubMentions={clubMentions}
      />
    </div>
  );
}
