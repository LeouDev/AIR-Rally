"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordPoint, undoPoint, submitResult, RankedError } from "@/lib/services/ranked";
import { isFinishedGame } from "@/lib/ranked";
import { CourtDiagram } from "@/components/ranked/CourtDiagram";
import type { RankedMatchDetail } from "@/lib/services/ranked";

/**
 * The live phase. Direct browser Supabase RPC calls, not Server Actions —
 * a referee standing courtside taps this dozens of times a game, and
 * every other player's screen has to catch up over Realtime in close to
 * real time (see useRankedMatch). A Server Action's page-revalidate round
 * trip is the wrong latency budget for that; the plain RPC call here is
 * the same write set_ranked_ready etc. reach through actions/ranked.ts,
 * just called straight from the client for a tighter loop.
 */
export function LiveScoreboard({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isScorekeeper = match.scorekeeper_id === currentUserId;
  const teamA = match.players.filter((p) => p.team === "a");
  const teamB = match.players.filter((p) => p.team === "b");
  const finished = isFinishedGame(match);

  function run(action: () => Promise<void>) {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof RankedError ? err.message : "That didn't go through. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col border-2 border-navy bg-navy text-navy-foreground">
      <div className="flex items-baseline justify-between border-b-2 border-navy-foreground/25 px-5 py-3">
        <span className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">
          {isScorekeeper ? "You're keeping score" : `Scorekeeper: ${match.scorekeeper?.display_name ?? "—"}`}
        </span>
        <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/50 uppercase">
          {finished ? "Game point reached" : "In progress · Game 1"}
        </span>
      </div>

      <div className="grid grid-cols-2 border-b-2 border-navy-foreground/25">
        <div className="border-r-2 border-navy-foreground/25 px-5 py-4.5">
          <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/55 uppercase">Team A</p>
          <p className={`mt-1.5 text-[3.5rem] leading-[0.85] font-extrabold ${match.serving_team === "a" ? "text-rally" : ""}`}>
            {match.score_a}
          </p>
          <p className="mt-1.5 text-[0.625rem] font-semibold tracking-[0.08em] text-navy-foreground/50">
            {teamA.map((p) => p.profile?.display_name?.split(" ")[0] ?? "—").join(" · ")}
          </p>
        </div>
        <div className="px-5 py-4.5">
          <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/55 uppercase">Team B</p>
          <p className={`mt-1.5 text-[3.5rem] leading-[0.85] font-extrabold ${match.serving_team === "b" ? "text-rally" : ""}`}>
            {match.score_b}
          </p>
          <p className="mt-1.5 text-[0.625rem] font-semibold tracking-[0.08em] text-navy-foreground/50">
            {teamB.map((p) => p.profile?.display_name?.split(" ")[0] ?? "—").join(" · ")}
          </p>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/55 uppercase">Live court</span>
          <span className="text-[0.625rem] font-bold tracking-[0.08em] text-rally uppercase">
            Serving: team {match.serving_team}
          </span>
        </div>
        <CourtDiagram serving={match.serving_team} />
      </div>

      {error && <p className="mx-5 mb-2 text-xs font-semibold text-rally">{error}</p>}

      {isScorekeeper ? (
        <div className="flex flex-col gap-2.5 px-5 pb-5">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => recordPoint(createClient(), match.id, "a"))}
            className="w-full bg-rally py-6 text-left text-[1.0625rem] font-extrabold tracking-[0.06em] text-white uppercase active:bg-primary-pressed disabled:opacity-60"
          >
            + Point team A
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => recordPoint(createClient(), match.id, "b"))}
            className="w-full border-2 border-navy-foreground py-6 text-left text-[1.0625rem] font-extrabold tracking-[0.06em] uppercase active:bg-navy-foreground/15 disabled:opacity-60"
          >
            + Point team B
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isPending || (match.score_a === 0 && match.score_b === 0)}
              onClick={() => run(() => undoPoint(createClient(), match.id))}
              className="border-2 border-navy-foreground/40 py-3.5 text-left text-xs font-bold tracking-[0.08em] uppercase disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              disabled={isPending || !finished}
              onClick={() => run(() => submitResult(createClient(), match.id))}
              className="border-2 border-navy-foreground/40 py-3.5 text-left text-xs font-bold tracking-[0.08em] uppercase disabled:opacity-40"
            >
              Submit final
            </button>
          </div>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[0.8125rem] text-navy-foreground/70">
          Watching live — only {match.scorekeeper?.display_name ?? "the scorekeeper"} can record points.
        </p>
      )}
    </div>
  );
}
