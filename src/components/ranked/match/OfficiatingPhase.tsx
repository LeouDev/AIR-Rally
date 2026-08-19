"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { proposeRankedOfficiatingAction, voteRankedOfficiatingAction } from "@/lib/actions/ranked";
import { searchPlayersAction } from "@/lib/actions/profile";
import { listRefereeCandidates } from "@/lib/services/ranked";
import { createClient } from "@/lib/supabase/client";
import { officiatingTally } from "@/lib/ranked";
import type { RankedMatchDetail } from "@/lib/services/ranked";
import type { PublicProfile } from "@/lib/supabase/types";

function initials(name: string | null): string {
  return (name ?? "?").trim().slice(0, 2).toUpperCase();
}

/**
 * "Select referee" and "no referee available?" are one component with
 * local view state, not two routes — the design's split is a page-per-state
 * mockup convention, but here the two paths converge on the same
 * `propose_ranked_officiating()` call and the same unanimous-vote UI once a
 * scorekeeper is proposed, so a single component tracking "which picker is
 * open" is the more honest model of what's actually happening.
 */
export function OfficiatingPhase({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  const [view, setView] = useState<"mode" | "referee" | "scorekeeper">("mode");
  // null = not fetched (yet) for the current referee-picker visit — the
  // loading state, so entering the picker never needs a synchronous
  // setState at the top of the effect below (React flags that as a
  // cascading-render smell): the effect's first state write happens only
  // once the fetch actually resolves.
  const [candidates, setCandidates] = useState<PublicProfile[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  const [isPending, startTransition] = useTransition();

  const me = match.players.find((p) => p.user_id === currentUserId);
  const proposed = Boolean(match.scorekeeper_id);
  const excludeIds = match.players.map((p) => p.user_id);

  useEffect(() => {
    if (view !== "referee" || match.event_id === null || proposed) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const found = await listRefereeCandidates(
        supabase,
        match.event_id!,
        match.players.map((p) => p.user_id)
      ).catch(() => [] as PublicProfile[]);
      if (!cancelled) setCandidates(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [view, match.event_id, proposed, match.players]);

  function openRefereePicker() {
    setCandidates(null);
    setView("referee");
  }

  function handleRefereeSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    startTransition(async () => {
      const result = await searchPlayersAction(value);
      if (result.success) {
        const excluded = new Set(excludeIds);
        setSearchResults(result.data.filter((p) => !excluded.has(p.id)));
      }
    });
  }

  function propose(mode: "referee" | "player_scorekeeper", scorekeeperId: string) {
    if (isPending) return;
    startTransition(async () => {
      const result = await proposeRankedOfficiatingAction(match.id, mode, scorekeeperId);
      if (!result.success) toast.error(result.error);
    });
  }

  function vote(approve: boolean) {
    if (isPending) return;
    startTransition(async () => {
      const result = await voteRankedOfficiatingAction(match.id, approve);
      if (!result.success) toast.error(result.error);
    });
  }

  if (proposed) {
    const scorekeeper = match.scorekeeper ?? match.players.find((p) => p.user_id === match.scorekeeper_id)?.profile ?? null;
    const tally = officiatingTally(match.players);
    const myVote = me?.officiating_vote ?? null;

    return (
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-navy/55 uppercase">All players ready</p>
          <h2 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">
            SELECT
            <br />
            REFEREE
          </h2>
        </div>

        <div className="flex flex-col gap-4 border-2 border-navy bg-white px-4.5 py-4.5">
          <div className="flex items-center gap-3.5">
            <span className="grid size-[52px] shrink-0 place-items-center bg-navy text-base font-bold text-navy-foreground">
              {initials(scorekeeper?.display_name ?? null)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-lg font-extrabold text-navy">{scorekeeper?.display_name ?? "Scorekeeper"}</p>
              <p className="text-[0.625rem] font-semibold tracking-[0.1em] text-navy/55 uppercase">
                {match.officiating_mode === "referee" ? "Not in this match" : "One of the four players"}
              </p>
            </div>
          </div>
          <div className="h-0.5 bg-navy" />
          <div className="flex flex-col gap-2.5">
            {match.players.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between">
                <span className="text-sm font-semibold text-navy">{p.profile?.display_name ?? "Player"}</span>
                <span className={`text-[0.625rem] font-bold tracking-[0.1em] ${p.officiating_vote ? "text-rally" : "text-navy/40"}`}>
                  {p.officiating_vote ? "AGREED" : "PENDING"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">Unanimous approval</span>
            <span className="text-sm font-extrabold text-navy">
              {tally.approved} / {tally.total}
            </span>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${tally.total}, 1fr)` }}>
            {match.players.map((p) => (
              <span key={p.user_id} className={`h-3 ${p.officiating_vote ? "bg-rally" : "bg-navy/15"}`} />
            ))}
          </div>
        </div>

        {me && (
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => vote(true)}
              disabled={isPending || myVote === true}
              className="w-full bg-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase disabled:opacity-60"
            >
              {myVote === true ? "You agreed" : "Agree"}
            </button>
            <button
              type="button"
              onClick={() => (match.officiating_mode === "referee" ? setView("scorekeeper") : openRefereePicker())}
              disabled={isPending}
              className="w-full border-2 border-navy py-3.5 text-left text-xs font-bold tracking-[0.08em] text-navy uppercase"
            >
              {match.officiating_mode === "referee" ? "No referee available?" : "Try a referee instead"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (view === "mode") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-navy/55 uppercase">All players ready</p>
          <h2 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">
            SELECT
            <br />
            REFEREE
          </h2>
        </div>
        <button
          type="button"
          onClick={openRefereePicker}
          className="flex flex-col gap-2 border-2 border-navy/25 px-5 py-4.5 text-left transition-colors hover:border-navy"
        >
          <span className="text-lg font-extrabold text-navy">FIND REFEREE</span>
          <span className="text-[0.8125rem] leading-relaxed text-navy/75">
            A non-playing person calls the score from courtside. All four players must approve.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setView("scorekeeper")}
          className="flex flex-col gap-2 border-2 border-navy/25 px-5 py-4.5 text-left transition-colors hover:border-navy"
        >
          <span className="text-lg font-extrabold text-navy">USE PLAYER SCOREKEEPER</span>
          <span className="text-[0.8125rem] leading-relaxed text-navy/75">
            One of the four players manages the official score.
          </span>
        </button>
      </div>
    );
  }

  if (view === "scorekeeper") {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setView("mode")}
          className="self-start text-[0.6875rem] font-semibold tracking-[0.08em] text-navy/55 uppercase hover:text-navy"
        >
          ← Back
        </button>
        <p className="text-sm font-semibold text-navy">Who keeps score?</p>
        <div className="flex flex-col border-2 border-navy bg-white">
          {match.players.map((p) => (
            <button
              key={p.user_id}
              type="button"
              onClick={() => propose("player_scorekeeper", p.user_id)}
              disabled={isPending}
              className="flex items-center gap-3 border-b-2 border-navy/10 px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-navy/5 disabled:opacity-60"
            >
              <span className="grid size-9 shrink-0 place-items-center bg-navy text-xs font-bold text-navy-foreground">
                {initials(p.profile?.display_name ?? null)}
              </span>
              <span className="text-sm font-bold text-navy">
                {p.profile?.display_name ?? "Player"}
                {p.user_id === currentUserId && " (you)"}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // view === "referee"
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setView("mode")}
        className="self-start text-[0.6875rem] font-semibold tracking-[0.08em] text-navy/55 uppercase hover:text-navy"
      >
        ← Back
      </button>
      <p className="text-sm font-semibold text-navy">Who&apos;s refereeing?</p>

      {match.event_id ? (
        candidates === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-navy/55">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking who&apos;s courtside…
          </div>
        ) : candidates.length > 0 ? (
          <div className="flex flex-col border-2 border-navy bg-white">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => propose("referee", c.id)}
                disabled={isPending}
                className="flex items-center justify-between gap-3 border-b-2 border-navy/10 px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-navy/5 disabled:opacity-60"
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center bg-navy text-xs font-bold text-navy-foreground">
                    {initials(c.display_name)}
                  </span>
                  <span className="text-sm font-bold text-navy">{c.display_name}</span>
                </span>
                <span className="text-[0.625rem] font-bold tracking-[0.08em] text-rally">AVAILABLE COURTSIDE</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="border-2 border-navy/20 px-4 py-4 text-sm text-navy/55">
            Nobody else at this session is free right now. Search by name instead, or use a player scorekeeper.
          </p>
        )
      ) : null}

      <input
        type="text"
        value={query}
        onChange={(e) => handleRefereeSearch(e.target.value)}
        placeholder="Search players by name"
        aria-label="Search players by name"
        className="w-full border-2 border-navy bg-white px-3.5 py-3 text-sm text-navy outline-none placeholder:text-navy/40"
      />
      {searchResults.length > 0 && (
        <div className="flex flex-col border-2 border-navy bg-white">
          {searchResults.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => propose("referee", p.id)}
              disabled={isPending}
              className="flex items-center gap-3 border-b-2 border-navy/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-navy/5 disabled:opacity-60"
            >
              <span className="grid size-8 shrink-0 place-items-center bg-navy/10 text-[0.6875rem] font-bold text-navy">
                {initials(p.display_name)}
              </span>
              <span className="text-sm font-medium text-navy">{p.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
