import { RankBadge } from "@/components/ranked/RankBadge";
import { climbState, tierInfo, pipNumeral } from "@/lib/ranked";
import type { PlayerRank } from "@/lib/supabase/types";

/**
 * The "CLIMB" module from Ranked Home: current badge, a fill bar toward
 * the next tier, next badge dimmed until it's earned. At the ceiling
 * (Champion) there's nowhere further to show, so the bar reads as full
 * and the copy says so instead of pointing at a tier that doesn't exist.
 */
export function ClimbBar({ rank }: { rank: Pick<PlayerRank, "tier" | "pips"> }) {
  const climb = climbState(rank);
  const current = tierInfo(rank.tier);
  const next = climb.nextTier ? tierInfo(climb.nextTier) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">Climb</p>
      <div className="flex items-center gap-3">
        <RankBadge tier={rank.tier} size={34} />
        <div className="flex h-3.5 flex-1 bg-navy/15">
          <div className="bg-rally transition-[width]" style={{ width: `${Math.round(climb.progress * 100)}%` }} />
        </div>
        {next ? (
          <RankBadge tier={climb.nextTier!} size={34} className="opacity-35" />
        ) : (
          <span className="grid size-[34px] shrink-0 place-items-center text-rally">★</span>
        )}
      </div>
      <div className="flex items-center justify-between text-[0.625rem] font-semibold tracking-[0.1em] text-navy">
        <span>
          {current.name.toUpperCase()} {pipNumeral(rank.pips)}
        </span>
        <span className="text-navy/50">{next ? `NEXT: ${next.name.toUpperCase()}` : "TOP TIER"}</span>
      </div>
      {/* "Near," not "one win from" — rank is derived continuously from
          AAR now, so there's no discrete next-match promotion the way
          the old pip ratchet guaranteed one. A big win could cross
          straight into the next tier from anywhere; this only means the
          player is already at the top star of this one. */}
      {climb.nearPromotion && (
        <div className="flex items-center gap-2 bg-navy px-3 py-2.5 text-[0.6875rem] font-semibold text-navy-foreground">
          <span className="text-rally">◆</span> NEAR {next?.name.toUpperCase()}
        </div>
      )}
    </div>
  );
}
