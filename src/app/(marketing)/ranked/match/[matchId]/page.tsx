import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { SignInGate } from "@/components/shared/SignInGate";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getMatch } from "@/lib/services/ranked";
import { RankedMatchRoom } from "@/components/ranked/match/RankedMatchRoom";

export const dynamic = "force-dynamic";

// Branded but non-revealing, deliberately identical for every match
// regardless of status — a match's score/players are gated content (see
// the signed-out state below), and the founder's own read on this was
// explicit: a public preview must never surface what a signed-out visitor
// isn't allowed to see on the page itself. This ALSO fixes what an
// earlier version of this file did: returning real score/player data
// whenever status='confirmed' leaked exactly that gated content into a
// link preview, reachable by anyone holding the URL without ever signing
// in — the same shape of mistake as court-side/[userId]'s title leak,
// caught before it shipped rather than after.
export const metadata: Metadata = {
  title: "AIR/Rally Match Result",
  description: "Sign in to view this match on AIR/Rally.",
  openGraph: {
    title: "AIR/Rally Match Result",
    description: "Sign in to view this match on AIR/Rally.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AIR/Rally Match Result",
    description: "Sign in to view this match on AIR/Rally.",
    images: ["/brand/og-image.png"],
  },
};

export default async function RankedMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  // Not requireSignedIn(): that redirected a signed-out visitor straight
  // to /login with no context — they never knew what they were trying to
  // open. Founder's own decision on this route: match results stay
  // gated (this is NOT the /support case), but the gate itself should be
  // a real, branded page rather than a blind redirect.
  const user = await getCurrentUser();

  if (!user) {
    return (
      <SignInGate
        icon={Trophy}
        title="Sign in to view this match result"
        description="AIR/Rally Ranked match results are only visible to signed-in players."
        redirectTo={`/ranked/match/${matchId}`}
        showCreateAccount
      />
    );
  }

  const supabase = await createClient();
  const match = await getMatch(supabase, matchId);

  if (!match) notFound();

  // RLS already scopes what getMatch can return (participants, the
  // scorekeeper, and admins — see the ranked_matches SELECT policy in
  // 20260810000067_air_rally_ranked.sql), so a non-participant gets no
  // row back at all rather than reaching this check; this is the belt to
  // that RLS braces, and what turns "no row" into an honest 404 for
  // everyone else instead of a confusing empty page.
  const isParticipant =
    match.players.some((p) => p.user_id === user.id) || match.scorekeeper_id === user.id || match.status === "confirmed";
  if (!isParticipant) notFound();

  return <RankedMatchRoom matchId={matchId} initial={match} currentUserId={user.id} />;
}
