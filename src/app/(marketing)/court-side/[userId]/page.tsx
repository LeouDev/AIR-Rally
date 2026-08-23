import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { SignInGate } from "@/components/shared/SignInGate";
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

// Branded but non-revealing for a signed-out visitor, worded to match
// /ranked/match/[matchId]'s signed-out state — the same product, the
// same reason: a person's identity shouldn't unfurl to anyone holding
// the URL (founder's decision, alongside bookings). Real title only for
// a signed-in caller, below.
const SIGNED_OUT_METADATA = {
  title: "AIR/Rally Player Profile",
  description: "Sign in to view this player's profile on AIR/Rally.",
  openGraph: {
    title: "AIR/Rally Player Profile",
    description: "Sign in to view this player's profile on AIR/Rally.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "AIR/Rally Player Profile",
    description: "Sign in to view this player's profile on AIR/Rally.",
    images: ["/brand/og-image.png"],
  },
};

export async function generateMetadata({ params }: PageProps) {
  const { userId } = await params;
  // A player profile is explicitly NOT a public-preview object (founder's
  // decision, alongside bookings — a person's identity shouldn't unfurl
  // to anyone holding the URL). The page body below already refuses to
  // render anything for a signed-out visitor; this used to still leak
  // the real display_name into <title> regardless, since it never
  // checked the session at all. Checked here now, the same way the body
  // does, rather than assumed safe because the body has its own gate.
  const session = await getCurrentUserWithProfile();
  if (!session) return SIGNED_OUT_METADATA;

  const supabase = await createClient();
  const profile = await getPublicProfile(supabase, userId);
  return { title: profile?.display_name ? `${profile.display_name} — My/Rally` : "My/Rally" };
}

export default async function UserRallyProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const session = await getCurrentUserWithProfile();

  if (!session) {
    return (
      <SignInGate
        icon={Users}
        title="Sign in to view this player's profile"
        description="COURT/Side is AIR/Rally's community hub — sign in to see what players are posting."
        redirectTo={`/court-side/${userId}`}
        backLink={{ href: "/court-side", label: "Back to COURT/Side" }}
        showCreateAccount
      />
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
