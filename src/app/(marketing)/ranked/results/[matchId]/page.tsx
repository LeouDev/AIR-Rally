import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { getPublicRankedMatchSummaryAction } from "@/lib/actions/ranked";

/**
 * The artifact a player shares after a match — same shape and reasoning
 * as /venues/requests/[requestId]: NO SESSION REQUIRED, deliberately. The
 * actual reader is the group chat, the club, the friend who doesn't have
 * the app yet, reached via a "Share result" button on the authenticated
 * match room. That authenticated room stays the destination for
 * participants (their own rating impact, live state) — this page is for
 * everyone else.
 *
 * Keyed on the match's own id. Every call goes through
 * getPublicRankedMatchSummaryAction(), which reaches
 * public_ranked_match_summary() (migration 20260810000107) — the one
 * ranked function granted to `anon`, and the only one that will ever
 * answer for a match that isn't 'confirmed'.
 */
export const dynamic = "force-dynamic";

// Never indexed — a shared result is for the person holding the link, not
// a search result. Same reasoning as the venue-request share page.
export const metadata: Metadata = {
  title: "AIR/Rally Match Result",
  robots: { index: false, follow: false },
};

function formatMatchDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default async function PublicRankedMatchResultPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const result = await getPublicRankedMatchSummaryAction(matchId);

  if (!result.success || !result.data) notFound();
  const { matchType, scoreA, scoreB, winningTeam, rated, confirmedAt, venueName, players } = result.data;

  const teamAPlayers = players.filter((p) => p.team === "a");
  const teamBPlayers = players.filter((p) => p.team === "b");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16 text-center sm:px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Trophy className="size-6" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">
          {matchType === "singles" ? "Singles" : "Doubles"}
          {venueName ? ` · ${venueName}` : ""}
          {confirmedAt ? ` · ${formatMatchDate(confirmedAt)}` : ""}
        </p>
        {/* A casual result is a real score that touched nobody's rating —
            labelled here so a shared link never reads as a ranked one to
            someone who doesn't know the difference. */}
        {!rated && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Casual match — not rated
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-6">
        <div className="flex flex-1 flex-col items-center gap-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Team A</p>
          {teamAPlayers.map((p) => (
            <p key={p.displayName} className="text-sm font-medium text-foreground">
              {p.displayName}
            </p>
          ))}
        </div>
        <div className="flex flex-col items-center">
          <p className={`text-4xl font-bold ${winningTeam === "a" ? "text-primary" : "text-foreground"}`}>{scoreA}</p>
          <p className="text-xs text-muted-foreground">–</p>
          <p className={`text-4xl font-bold ${winningTeam === "b" ? "text-primary" : "text-foreground"}`}>{scoreB}</p>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Team B</p>
          {teamBPlayers.map((p) => (
            <p key={p.displayName} className="text-sm font-medium text-foreground">
              {p.displayName}
            </p>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        AIR/Rally is a pickleball booking and ranked-play app.
      </p>
    </div>
  );
}
