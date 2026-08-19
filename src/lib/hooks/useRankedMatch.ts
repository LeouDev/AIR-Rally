"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMatch, type RankedMatchDetail } from "@/lib/services/ranked";

/** Backstop only — Realtime is the actual delivery mechanism. See below. */
const FALLBACK_POLL_MS = 5000;

/**
 * Keeps a ranked match room live. The referee's device writes a point;
 * every other player's screen has to reflect it in close to real time
 * without a manual refresh — a scoreboard four people are watching
 * together doesn't work as a poll.
 *
 * Strategy: on any change to this match's row or its players' rows,
 * refetch the whole match detail rather than trying to patch individual
 * fields from the Realtime payload. A ranked match room is low-frequency
 * (points are seconds apart, a whole game is a few dozen of them) and
 * `getMatch` is a handful of PostgREST queries under RLS everyone here
 * can already read — patching partial state correctly (derived fields
 * like tier snapshots, joined profiles) would be more code for a
 * difference nobody would notice.
 *
 * The refresh on mount is unconditional, not gated behind a "have I
 * synced yet" ref. React's Strict Mode (dev only) mounts every effect
 * twice — mount, cleanup, mount again — specifically so effects that
 * assume "runs once" break loudly instead of hiding a bug. A ref-gated
 * "only the first mount resyncs" tripped on exactly that: the doomed
 * first mount claimed the resync and its own cleanup discarded the
 * result, and the surviving second mount found the gate already closed
 * and never asked at all. Calling refresh() unconditionally costs one
 * harmless extra fetch under Strict Mode and nothing in production,
 * where effects only mount once.
 *
 * The interval poll is a backstop, not the delivery mechanism — Realtime
 * is. It exists because a Realtime channel can report SUBSCRIBED and
 * then silently deliver nothing, with no error anywhere a client can
 * see: this exact failure mode showed up live on this feature (the
 * `ranked_*` tables needed REPLICA IDENTITY FULL for Realtime to
 * evaluate their RLS policies on UPDATE — see the migration), and there
 * is no way to prove from the browser alone that some other, different
 * silent gap isn't waiting in a different environment. Five seconds
 * keeps a stuck screen from staying stuck for more than a few points.
 */
export function useRankedMatch(matchId: string, initial: RankedMatchDetail) {
  const [match, setMatch] = useState<RankedMatchDetail>(initial);

  useEffect(() => {
    let cancelled = false;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // Not configured — the initial server-rendered snapshot is all there is.
    }

    async function refresh() {
      const fresh = await getMatch(supabase, matchId).catch(() => null);
      if (fresh && !cancelled) setMatch(fresh);
    }

    void refresh();

    const channel = supabase
      .channel(`ranked-match-${matchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ranked_matches", filter: `id=eq.${matchId}` }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ranked_match_players", filter: `match_id=eq.${matchId}` },
        refresh
      )
      .subscribe();

    const interval = setInterval(() => void refresh(), FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  return match;
}
