import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { UserRallyProfile } from "@/components/court-side/UserRallyProfile";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getPublicProfile } from "@/lib/services/profiles";
import { listPostsByUser, listLikedPostIds, listResharedPostIds } from "@/lib/services/posts";
import { listFollowingIds, getFollowCounts } from "@/lib/services/follows";
import { resolveClubMentionsForPosts } from "@/lib/services/clubs";
import { BackLink } from "@/components/shared/BackLink";

// Renders per-viewer data (own like/follow state via a cookie-scoped
// Supabase session) for whichever profile the URL names — never cached
// or shared across visitors.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ userId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { userId } = await params;
  const supabase = await createClient();
  const profile = await getPublicProfile(supabase, userId);
  return { title: profile?.display_name ? `${profile.display_name} — My/Rally` : "My/Rally" };
}

export default async function UserRallyProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const session = await getCurrentUserWithProfile();

  if (!session) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4">
          <BackLink href="/court-side" label="Back to COURT/Side" />
        </div>
        <EmptyState
          icon={Users}
          title="Sign in to view this profile"
          description="COURT/Side is AIR/Rally's community hub — sign in to see what players are posting."
          action={
            <div className="flex gap-3">
              <Button asChild>
                <Link href={`/login?redirect=/court-side/${userId}`}>Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/signup?redirect=/court-side/${userId}`}>Create Account</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const supabase = await createClient();
  const profile = await getPublicProfile(supabase, userId);
  if (!profile) notFound();

  const [{ posts, nextCursor }, followCounts] = await Promise.all([
    listPostsByUser(supabase, userId),
    getFollowCounts(supabase, userId),
  ]);

  const postIds = posts.map((p) => p.id);
  const [likedPostIds, resharedPostIds, viewerFollowsThisUser, clubMentions] = await Promise.all([
    listLikedPostIds(supabase, session.user.id, postIds),
    listResharedPostIds(supabase, session.user.id, postIds),
    listFollowingIds(supabase, session.user.id, [userId]),
    resolveClubMentionsForPosts(supabase, posts.map((p) => p.content)),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4">
        <BackLink href="/court-side" label="Back to COURT/Side" />
      </div>
      <UserRallyProfile
        viewerId={session.user.id}
        isAdmin={session.profile?.role === "admin"}
        profile={profile}
        initialFollowerCount={followCounts.followers}
        initialFollowingCount={followCounts.following}
        initialIsFollowing={viewerFollowsThisUser.includes(userId)}
        initialPosts={posts}
        initialNextCursor={nextCursor}
        initialLikedPostIds={likedPostIds}
        initialResharedPostIds={resharedPostIds}
        clubMentions={clubMentions}
      />
    </div>
  );
}
