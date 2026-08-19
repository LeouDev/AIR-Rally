import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getMatch } from "@/lib/services/ranked";
import { RankedMatchRoom } from "@/components/ranked/match/RankedMatchRoom";

export const metadata: Metadata = { title: "Match — Ranked" };
export const dynamic = "force-dynamic";

export default async function RankedMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const user = await requireSignedIn(`/ranked/match/${matchId}`);
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
