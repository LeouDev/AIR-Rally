"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setRankedReadyAction, cancelRankedMatchAction } from "@/lib/actions/ranked";
import { readyTally, matchBalance } from "@/lib/ranked";
import { RATING_STARTING_VALUE } from "@/lib/rating";
import { PlayerRow } from "@/components/ranked/match/PlayerRow";
import type { RankedMatchDetail } from "@/lib/services/ranked";

export function LobbyPhase({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const me = match.players.find((p) => p.user_id === currentUserId);
  const teamA = match.players.filter((p) => p.team === "a");
  const teamB = match.players.filter((p) => p.team === "b");
  const tally = readyTally(match.players);
  const balance = matchBalance(
    teamA.map((p) => p.rank?.rating ?? RATING_STARTING_VALUE),
    teamB.map((p) => p.rank?.rating ?? RATING_STARTING_VALUE)
  );

  function toggleReady() {
    if (!me || isPending) return;
    startTransition(async () => {
      const result = await setRankedReadyAction(match.id, !me.ready);
      if (!result.success) toast.error(result.error);
    });
  }

  function cancel() {
    if (isPending) return;
    startTransition(async () => {
      const result = await cancelRankedMatchAction(match.id);
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col border-2 border-navy bg-navy text-navy-foreground">
      <div className="flex items-baseline justify-between border-b-2 border-navy-foreground/25 px-5 py-3.5">
        <span className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">Match found</span>
        <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/50 uppercase">
          {match.match_type} · to {match.target_score}
        </span>
      </div>

      <div className="px-5 pt-4 pb-1 text-[0.625rem] font-semibold tracking-[0.16em] text-navy-foreground/50 uppercase">Team A</div>
      <div className="px-5">
        {teamA.map((p) => (
          <PlayerRow
            key={p.user_id}
            player={p}
            isYou={p.user_id === currentUserId}
            trailing={p.ready ? "READY" : "WAITING"}
            trailingColorClass={p.ready ? "text-rally" : "text-navy-foreground/45"}
          />
        ))}
      </div>

      <div className="flex items-center gap-3.5 px-5 py-4">
        <span className="h-0.5 flex-1 bg-navy-foreground/25" />
        <span className="text-lg font-extrabold text-rally">VS</span>
        <span className="h-0.5 flex-1 bg-navy-foreground/25" />
      </div>

      <div className="px-5 pb-1 text-[0.625rem] font-semibold tracking-[0.16em] text-navy-foreground/50 uppercase">Team B</div>
      <div className="px-5">
        {teamB.map((p) => (
          <PlayerRow
            key={p.user_id}
            player={p}
            isYou={p.user_id === currentUserId}
            trailing={p.ready ? "READY" : "WAITING"}
            trailingColorClass={p.ready ? "text-rally" : "text-navy-foreground/45"}
          />
        ))}
      </div>

      <div className="m-5 flex items-center justify-between gap-3 border-2 border-rally px-4 py-3.5">
        <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/60 uppercase">Match balance</span>
        <div className="flex items-center gap-2.5">
          <div className="flex gap-[3px]">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={`h-4 w-1.5 ${i < balance.bars ? "bg-rally" : "bg-navy-foreground/25"}`} />
            ))}
          </div>
          <span className="text-sm font-extrabold uppercase">{balance.label}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-5 pb-5">
        <button
          type="button"
          onClick={toggleReady}
          disabled={isPending || !me}
          className={`w-full border-2 border-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] uppercase transition-colors disabled:opacity-60 ${
            me?.ready ? "bg-rally text-white" : "bg-transparent text-navy-foreground"
          }`}
        >
          {me?.ready ? "You're ready" : "Ready"}
        </button>
        <p className="pt-1 text-[0.625rem] font-semibold tracking-[0.12em] text-navy-foreground/50">
          {tally.ready} / {tally.total} PLAYERS READY{!tally.allReady && !me?.ready ? " — WAITING ON YOU" : ""}
        </p>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          className="mt-2 self-start text-[0.6875rem] font-semibold tracking-[0.08em] text-navy-foreground/50 uppercase hover:text-navy-foreground"
        >
          Cancel match
        </button>
      </div>
    </div>
  );
}
