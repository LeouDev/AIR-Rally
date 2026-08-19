import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listHostableBookings } from "@/lib/services/events";
import { getPublicProfile } from "@/lib/services/profiles";
import { getPlayerRank } from "@/lib/services/ranked";
import { CreateOpenPlayForm } from "@/components/events/CreateOpenPlayForm";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start a game" };

/** `?mode=ranked` preselects the Ranked branch — the dashboard's "Play ranked" CTA links here. */
export default async function NewOpenPlayPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const user = await requireSignedIn("/events/new");
  const supabase = await createClient();
  // Display-only reads — deliberately not ensureMyPlayerRank (a write):
  // create_ranked_match() bootstraps every party member's rank row itself,
  // so a Casual-only visitor here should never silently get a player_ranks
  // row just for having loaded this page.
  const [bookings, host, hostRank] = await Promise.all([
    listHostableBookings(supabase, user.id),
    getPublicProfile(supabase, user.id),
    getPlayerRank(supabase, user.id, "singles"),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <BackLink href="/events" label="Back to open play" />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Start a game</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite your playmates to a court you&apos;ve booked. You pay the venue; splitting it is between you and them.
        </p>
      </div>

      {host ? (
        <CreateOpenPlayForm bookings={bookings} host={host} hostRank={hostRank} initialMode={mode === "ranked" ? "ranked" : "casual"} />
      ) : (
        <p className="text-sm text-muted-foreground">We couldn&apos;t load your profile. Try again in a moment.</p>
      )}
    </div>
  );
}
