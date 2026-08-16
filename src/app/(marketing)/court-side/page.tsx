import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { CourtSideFeed } from "@/components/court-side/CourtSideFeed";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";

export const metadata = { title: "COURT/Side" };
// Renders per-user data (own profile via a cookie-scoped Supabase session)
// — must never be cached/shared across visitors like a static page would be.
export const dynamic = "force-dynamic";

export default async function CourtSidePage() {
  const session = await getCurrentUserWithProfile();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {!session ? (
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
      ) : (
        <CourtSideFeed
          displayName={session.profile?.display_name || session.user.email || "Player"}
          avatarUrl={session.profile?.avatar_url ?? null}
        />
      )}
    </div>
  );
}
