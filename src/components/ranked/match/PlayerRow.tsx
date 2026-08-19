import { RankBadge } from "@/components/ranked/RankBadge";
import { PipRow } from "@/components/ranked/PipRow";
import type { RankedMatchParticipant } from "@/lib/services/ranked";

function initials(name: string | null): string {
  return (name ?? "?").trim().slice(0, 2).toUpperCase();
}

/**
 * One player in a team roster, on the navy lobby/scoreboard surfaces.
 * `trailing` is whatever this phase wants on the right — a ready state,
 * a vote status, a confirmation status — so this stays one component
 * across the lobby, officiating and confirmation phases.
 */
export function PlayerRow({
  player,
  isYou,
  trailing,
  trailingColorClass = "text-rally",
}: {
  player: RankedMatchParticipant;
  isYou: boolean;
  trailing: string;
  trailingColorClass?: string;
}) {
  const name = player.profile?.display_name ?? "Player";
  // A PlayerRank row exists at its meaningless Dinker-star-1 default the
  // instant someone opens Ranked — see ensure_player_rank(). Only
  // is_calibrated means "this tier is real"; showing the badge before
  // that would tell this player's teammates a fake rank.
  const placed = player.rank?.is_calibrated ?? false;
  return (
    <div className="flex items-center gap-3.5 border-b-2 border-navy-foreground/15 py-3 last:border-b-0">
      <span className="grid size-10 shrink-0 place-items-center bg-rally text-[0.8125rem] font-bold text-white">
        {initials(name)}
      </span>
      {placed && <RankBadge tier={player.rank!.tier} on="navy" size={40} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-[0.9375rem] font-bold text-navy-foreground">
          {name}
          {isYou && " (you)"}
        </p>
        {player.rank && (
          <div className="flex items-center gap-2">
            {placed ? (
              <PipRow pips={player.rank.pips} on="navy" size="sm" />
            ) : (
              <span className="text-[0.625rem] font-semibold tracking-[0.08em] text-navy-foreground/60 uppercase">
                Unplaced
              </span>
            )}
          </div>
        )}
      </div>
      <span className={`shrink-0 text-[0.6875rem] font-bold tracking-[0.06em] ${trailingColorClass}`}>{trailing}</span>
    </div>
  );
}
