import Link from "next/link";
import { TriangleAlert, UserCircle } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { ProfileActionsMenu } from "@/components/profile/ProfileActionsMenu";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";
import { getProfileStats } from "@/lib/services/profiles";
import { getFollowCounts } from "@/lib/services/follows";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

export const metadata = { title: "Profile" };
// Renders per-user data (own profile via a cookie-scoped Supabase session)
// — must never be cached/shared across visitors like a static page would be.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getCurrentUserWithProfile();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
      <p className="mt-1 text-muted-foreground">Manage your account and preferences.</p>

      <div className="mt-8">
        {!session ? (
          <EmptyState
            icon={UserCircle}
            title="You're not signed in"
            description="Sign in to manage your bookings, favorites, and account details."
            action={
              <div className="flex gap-3">
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/signup">Create Account</Link>
                </Button>
              </div>
            }
          />
        ) : session.profile ? (
          <ProfileWithStats profile={session.profile} email={session.user.email ?? ""} />
        ) : (
          <EmptyState
            icon={TriangleAlert}
            title="We couldn't load your profile"
            description="Something went wrong loading your account. Please refresh, or try again shortly."
          />
        )}
      </div>
    </div>
  );
}

async function ProfileWithStats({ profile, email }: { profile: Profile; email: string }) {
  const supabase = await createClient();
  const [stats, followCounts] = await Promise.all([
    getProfileStats(supabase, profile.id, profile.created_at),
    // Same counts COURT/Side shows on the public profile, so the two can
    // never disagree about how many followers someone has.
    getFollowCounts(supabase, profile.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader profile={profile} email={email} stats={stats} followCounts={followCounts} />
      <ProfileActionsMenu profile={profile} email={email} />
    </div>
  );
}
