"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { searchPlayersAction } from "@/lib/actions/profile";
import { createRankedMatchAction } from "@/lib/actions/ranked";
import { getPlayerRanks } from "@/lib/services/ranked";
import { createClient } from "@/lib/supabase/client";
import { RankBadge } from "@/components/ranked/RankBadge";
import { partyEligibilityDisplay, rankLabel } from "@/lib/ranked";
import { cn } from "@/lib/utils";
import type { PlayerRank, PublicProfile, RankedMatchType } from "@/lib/supabase/types";

type Slot = {
  key: string;
  team: "a" | "b";
  /** The single fixed slot — never searched, never removed. */
  isHost?: boolean;
  roleLabel: string;
  player: PublicProfile | null;
};

function initials(name: string | null): string {
  return (name ?? "?").trim().slice(0, 2).toUpperCase();
}

function slotsFor(matchType: RankedMatchType, host: PublicProfile): Slot[] {
  const base: Slot[] = [{ key: "host", team: "a", isHost: true, roleLabel: "HOST", player: host }];
  if (matchType === "singles") {
    return [...base, { key: "opp1", team: "b", roleLabel: "OPPONENT", player: null }];
  }
  return [
    { ...base[0] },
    { key: "partner", team: "a", roleLabel: "PARTNER", player: null },
    { key: "opp1", team: "b", roleLabel: "OPPONENT", player: null },
    { key: "opp2", team: "b", roleLabel: "OPPONENT", player: null },
  ];
}

/**
 * Assembles a ranked party and starts the match.
 *
 * The host is a fixed slot; everyone else is picked by name search (the
 * same `searchPlayersAction` the Open Play roster picker uses — see
 * `components/court/PlayerPicker.tsx`) and lands in the first open slot
 * for their team. Team assignment happens here, at setup, rather than
 * through a separate matchmaking step: this is a challenge-your-friends
 * flow, not a public queue.
 *
 * `partyEligibilityDisplay` (lib/ranked.ts) previews the same AAR-based
 * spread rule `create_ranked_match()` enforces, so FIND RANKED MATCH can
 * grey out before a round trip — but the database re-checks it, and
 * that check is the one that actually matters.
 *
 * Singles and doubles are independent ratings (DUPR-inspired rating
 * engine, 20260810000068), so every fetched `PlayerRank` — including the
 * host's — is specific to the CURRENT `matchType`. Switching match type
 * clears every non-host slot (as before) and re-fetches the host's rank
 * for the new mode.
 *
 * `onSubmit`, when provided, replaces the default "call
 * createRankedMatchAction and redirect to the match lobby" behavior —
 * for a host embedding this inside a bigger flow (the unified Open
 * Play/Ranked creation form) that has to create something else first
 * and owns its own navigation once that's done.
 */
export function RankedPartyBuilder({
  host,
  hostRank,
  initialMatchType = "singles",
  eventId,
  courtId,
  onSubmit,
  submitLabel,
}: {
  host: PublicProfile;
  hostRank: PlayerRank | null;
  initialMatchType?: RankedMatchType;
  eventId?: string;
  courtId?: string;
  onSubmit?: (party: { matchType: RankedMatchType; teamA: string[]; teamB: string[] }) => void | Promise<void>;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [matchType, setMatchType] = useState<RankedMatchType>(initialMatchType);
  const [slots, setSlots] = useState<Slot[]>(() => slotsFor(initialMatchType, host));
  const [ranks, setRanks] = useState<Map<string, PlayerRank>>(new Map(hostRank ? [[host.id, hostRank]] : []));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();

  async function fetchRank(userId: string, mode: RankedMatchType) {
    try {
      const supabase = createClient();
      const fetched = await getPlayerRanks(supabase, [userId], mode);
      const rank = fetched.get(userId);
      if (rank) setRanks((prev) => new Map(prev).set(userId, rank));
      else setRanks((prev) => { const next = new Map(prev); next.delete(userId); return next; });
    } catch {
      // Not configured, or the lookup failed — the eligibility preview
      // just treats them as unplaced, same as a real uncalibrated player.
    }
  }

  function switchType(next: RankedMatchType) {
    setMatchType(next);
    setSlots(slotsFor(next, host));
    setQuery("");
    setResults([]);
    // Every rank on screen was for the OLD mode — clear the cache and
    // re-fetch the one slot that survives the switch (the host).
    setRanks(new Map());
    void fetchRank(host.id, next);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const result = await searchPlayersAction(value);
      if (result.success) {
        const taken = new Set(slots.filter((s) => s.player).map((s) => s.player!.id));
        setResults(result.data.filter((p) => !taken.has(p.id)));
      }
    });
  }

  function fillNextSlot(player: PublicProfile) {
    const openIndex = slots.findIndex((s) => !s.isHost && !s.player);
    if (openIndex === -1) return;
    setSlots((prev) => prev.map((s, i) => (i === openIndex ? { ...s, player } : s)));
    setQuery("");
    setResults([]);
    void fetchRank(player.id, matchType);
  }

  function clearSlot(key: string) {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, player: null } : s)));
  }

  const filledPlayers = slots.filter((s) => s.player).map((s) => s.player!);
  const allFilled = slots.every((s) => s.player);
  const eligibility = partyEligibilityDisplay(filledPlayers.map((p) => ranks.get(p.id) ?? null));

  function submit() {
    if (!allFilled || !eligibility.eligible || isSubmitting) return;
    const teamA = slots.filter((s) => s.team === "a").map((s) => s.player!.id);
    const teamB = slots.filter((s) => s.team === "b").map((s) => s.player!.id);
    if (onSubmit) {
      startSubmit(async () => {
        await onSubmit({ matchType, teamA, teamB });
      });
      return;
    }
    startSubmit(async () => {
      const result = await createRankedMatchAction({ matchType, teamA, teamB, eventId, courtId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(`/ranked/match/${result.data.matchId}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">Match type</p>
        <div className="grid grid-cols-2 border-2 border-navy">
          {(["singles", "doubles"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => switchType(type)}
              className={cn(
                "border-navy px-4 py-3.5 text-left text-[0.8125rem] font-bold tracking-[0.1em] uppercase transition-colors",
                type === "singles" && "border-r-2",
                matchType === type ? "bg-navy text-navy-foreground" : "bg-transparent text-navy hover:bg-navy/5"
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">
            Party · {filledPlayers.length} of {slots.length}
          </p>
        </div>

        {slots.map((slot) => {
          // A PlayerRank row exists (at its meaningless placeholder
          // default) the instant someone opens Ranked for the first
          // time — see ensure_player_rank(). Presence in `ranks` alone
          // is not "placed"; only is_calibrated is, and showing a
          // default-tier badge/label before that would tell this
          // player a fake rank.
          const rank = slot.player ? ranks.get(slot.player.id) : undefined;
          const placed = rank?.is_calibrated ?? false;
          return (
            <div key={slot.key} className="flex items-center gap-3 border-2 border-navy bg-white px-3.5 py-3">
              <span className="grid size-10 shrink-0 place-items-center bg-navy text-[0.8125rem] font-bold text-navy-foreground">
                {slot.player ? initials(slot.player.display_name) : "?"}
              </span>
              {placed && <RankBadge tier={rank!.tier} size={34} />}
              <div className="min-w-0 flex-1">
                {slot.player ? (
                  <>
                    <p className="truncate text-sm font-bold text-navy">
                      {slot.player.display_name}
                      {slot.isHost && " (you)"}
                    </p>
                    <p className="text-[0.625rem] font-semibold tracking-[0.1em] text-navy/60 uppercase">
                      {placed ? rankLabel(rank!.tier, rank!.pips) : "Not yet placed"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-navy/45">Search below to fill this spot</p>
                )}
              </div>
              {slot.isHost ? (
                <span className="shrink-0 text-[0.625rem] font-bold tracking-[0.1em] text-rally">{slot.roleLabel}</span>
              ) : slot.player ? (
                <button
                  type="button"
                  onClick={() => clearSlot(slot.key)}
                  aria-label={`Remove ${slot.player.display_name}`}
                  className="grid size-7 shrink-0 place-items-center text-navy/50 transition-colors hover:text-navy"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : (
                <span className="shrink-0 text-[0.625rem] font-bold tracking-[0.1em] text-navy/40">{slot.roleLabel}</span>
              )}
            </div>
          );
        })}
      </div>

      {!allFilled && (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-navy/45" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search players by name"
              aria-label="Search players by name"
              className="w-full border-2 border-navy bg-white py-3 pr-9 pl-9 text-sm text-navy outline-none placeholder:text-navy/40 focus-visible:bg-navy/5"
            />
            {isSearching && (
              <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-navy/45" aria-hidden="true" />
            )}
          </div>
          {results.length > 0 && (
            <ul className="flex flex-col border-2 border-navy bg-white">
              {results.map((player) => (
                <li key={player.id} className="border-b-2 border-navy last:border-b-0">
                  <button
                    type="button"
                    onClick={() => fillNextSlot(player)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-navy/5"
                  >
                    <span className="grid size-7 shrink-0 place-items-center bg-navy/10 text-[0.6875rem] font-bold text-navy">
                      {initials(player.display_name)}
                    </span>
                    <span className="truncate text-sm font-medium text-navy">{player.display_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && !isSearching && results.length === 0 && (
            <p className="text-xs text-navy/50">No players found. They need an AIR/Rally account first.</p>
          )}
        </div>
      )}

      {allFilled && !eligibility.eligible && (
        <div className="flex flex-col gap-2 border-2 border-rally bg-rally px-4 py-4 text-navy-foreground">
          <p className="text-base font-extrabold">PARTY RATING DIFFERENCE TOO LARGE</p>
          <p className="text-[0.8125rem] leading-relaxed">
            Players with significantly different ratings can&apos;t currently join the same Ranked party.
          </p>
          {eligibility.allowedLowestTierName && eligibility.allowedHighestTierName && (
            <p className="border-t border-white/35 pt-2 text-[0.6875rem] font-semibold tracking-[0.05em]">
              A party this wide needs every player within {eligibility.maxSpread} ARR of each other — roughly{" "}
              {eligibility.allowedLowestTierName} to {eligibility.allowedHighestTierName}.
            </p>
          )}
        </div>
      )}

      {allFilled && eligibility.eligible && (
        <div className="flex items-center justify-between border-2 border-navy px-4 py-3.5">
          <span className="text-[0.6875rem] font-semibold tracking-[0.1em] text-navy">PARTY ELIGIBLE</span>
          <span className="text-[0.6875rem] font-bold tracking-[0.1em] text-rally">READY</span>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!allFilled || !eligibility.eligible || isSubmitting}
        className="w-full bg-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? "Starting match…" : (submitLabel ?? "Find ranked match")}
      </button>
    </div>
  );
}
