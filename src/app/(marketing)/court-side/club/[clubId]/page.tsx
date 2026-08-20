import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { MyClubFeed } from "@/components/court-side/MyClubFeed";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getClubForViewer, listClubsForUser } from "@/lib/services/clubs";
import { listClubPosts, listLikedPostIds } from "@/lib/services/posts";
import { listFollowingIds } from "@/lib/services/follows";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export default async function MyClubPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const session = await getCurrentUserWithProfile();

  if (!session) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={Users}
          title="Sign in to see this club"
          description="My Club is only visible to a club's own members."
          action={
            <Button asChild>
              <Link href={`/login?redirect=/court-side/club/${clubId}`}>Sign In</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const supabase = await createClient();
  const club = await getClubForViewer(supabase, clubId, session.user.id);
  if (!club) notFound();

  // getClubForViewer returns the club even to a non-member (same posture
  // as getVenueDetail) — RLS on `posts` is the real boundary, but a clear
  // "you're not in" state reads better than a feed that's silently empty.
  if (!club.viewerRole) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <BackLink href="/court-side" label="Back to COURT/Side" />
        <EmptyState
          icon={Users}
          title={`You're not a member of ${club.name}`}
          description={club.viewerPending ? "Your request to join is still pending." : "Join the club to see its posts."}
          action={
            <Button asChild variant="outline">
              <Link href={`/clubs/${club.id}`}>View club</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const myClubs = await listClubsForUser(supabase, session.user.id);
  const { posts, nextCursor } = await listClubPosts(supabase, clubId);
  const postIds = posts.map((p) => p.id);
  const authorIds = Array.from(new Set(posts.map((p) => p.user_id)));

  const [likedPostIds, followingIds] = await Promise.all([
    listLikedPostIds(supabase, session.user.id, postIds),
    listFollowingIds(supabase, session.user.id, authorIds),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <BackLink href="/court-side" label="Back to COURT/Side" />

      {myClubs.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {myClubs.map((c) => (
            <Link
              key={c.id}
              href={`/court-side/club/${c.id}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                c.id === clubId
                  ? "border-primary bg-accent text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6">
        <MyClubFeed
          club={club}
          currentUserId={session.user.id}
          displayName={session.profile?.display_name || session.user.email || "Player"}
          avatarUrl={session.profile?.avatar_url ?? null}
          isAdmin={session.profile?.role === "admin"}
          initialPosts={posts}
          initialNextCursor={nextCursor}
          initialLikedPostIds={likedPostIds}
          initialFollowingIds={followingIds}
        />
      </div>
    </div>
  );
}
