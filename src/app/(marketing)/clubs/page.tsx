import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ClubCard } from "@/components/clubs/ClubCard";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listDiscoverableClubs, listClubsForUser } from "@/lib/services/clubs";

// Club visibility is per-viewer (RLS hides private clubs the caller
// isn't in), so this can never be statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Clubs",
  description: "Find and join pickleball clubs near you on Air/Rally.",
};

export default async function ClubsPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [discoverable, myClubs] = await Promise.all([
    listDiscoverableClubs(supabase),
    user ? listClubsForUser(supabase, user.id) : Promise.resolve([]),
  ]);

  const myClubIds = new Set(myClubs.map((c) => c.id));
  const others = discoverable.filter((c) => !myClubIds.has(c.id));

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Community</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Clubs</h1>
          <p className="mt-1 text-muted-foreground">Find your regular crew, or start one of your own.</p>
        </div>
        {user && (
          <Button asChild>
            <Link href="/clubs/new">Create a club</Link>
          </Button>
        )}
      </div>

      {myClubs.length > 0 && (
        <section className="mt-10">
          <h2 className="text-base font-semibold text-foreground">Your clubs</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myClubs.map((club) => (
              <ClubCard key={club.id} club={club} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-base font-semibold text-foreground">{myClubs.length > 0 ? "Discover more" : "Discover clubs"}</h2>
        {others.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Users}
              title="No clubs to show yet"
              description="Clubs are player-run communities. Start one and invite the people you already play with."
              action={
                user ? (
                  <Button asChild>
                    <Link href="/clubs/new">Create the first club</Link>
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href="/login?redirect=/clubs">Sign in to start a club</Link>
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((club) => (
              <ClubCard key={club.id} club={club} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
