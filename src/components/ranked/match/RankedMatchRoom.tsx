"use client";

import { useRankedMatch } from "@/lib/hooks/useRankedMatch";
import { LobbyPhase } from "@/components/ranked/match/LobbyPhase";
import { OfficiatingPhase } from "@/components/ranked/match/OfficiatingPhase";
import { LiveScoreboard } from "@/components/ranked/match/LiveScoreboard";
import { ResultPhase } from "@/components/ranked/match/ResultPhase";
import type { RankedMatchDetail } from "@/lib/services/ranked";

/**
 * One route for a match's entire life. The design decomposes this into
 * discrete screens (lobby, referee select, scoreboard, confirmation) as
 * separate mockup states, but they're really one URL a group of players
 * keeps open while `ranked_matches.status` moves underneath them —
 * useRankedMatch keeps this component's copy of that row live over
 * Realtime, and the phase below just follows it.
 */
export function RankedMatchRoom({ matchId, initial, currentUserId }: { matchId: string; initial: RankedMatchDetail; currentUserId: string }) {
  const match = useRankedMatch(matchId, initial);

  switch (match.status) {
    case "lobby":
      return <LobbyPhase match={match} currentUserId={currentUserId} />;
    case "officiating":
      return <OfficiatingPhase match={match} currentUserId={currentUserId} />;
    case "live":
      return <LiveScoreboard match={match} currentUserId={currentUserId} />;
    case "awaiting_confirmation":
    case "confirmed":
    case "disputed":
      return <ResultPhase match={match} currentUserId={currentUserId} />;
    case "cancelled":
      return (
        <div className="flex flex-col items-center gap-2 border-2 border-navy bg-white px-6 py-14 text-center">
          <p className="text-lg font-extrabold text-navy">This match was cancelled</p>
          <p className="text-sm text-navy/55">Nothing was recorded against anyone&apos;s rank.</p>
        </div>
      );
  }
}
