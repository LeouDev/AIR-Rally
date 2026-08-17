"use client";

import { useState, useTransition } from "react";
import { UserPlus, X, Search, Loader2 } from "lucide-react";
import { searchPlayersAction } from "@/lib/actions/profile";
import { calculateSplit, formatShare } from "@/lib/eventSplit";
import type { PublicProfile } from "@/lib/supabase/types";

/**
 * "Who's playing?" — picks the playmates coming to a booking.
 *
 * These are placeholders on a roster, NOT payers. One person pays the venue
 * for the whole court; this only records who's expected and shows what an
 * even split would come to. AIR/Rally collects nothing from the others, and
 * the copy below says so, because a peso figure next to a list of names
 * reads like a bill unless you're told otherwise.
 */
export function PlayerPicker({
  selected,
  onChange,
  totalAmount,
  currency = "PHP",
}: {
  selected: PublicProfile[];
  onChange: (players: PublicProfile[]) => void;
  /** The booking total, integer minor units. Drives the share preview. */
  totalAmount: number;
  currency?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [isSearching, startSearch] = useTransition();

  // Organiser + everyone they've added. They're playing too, so they count.
  const split = calculateSplit(totalAmount, selected.length + 1);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const result = await searchPlayersAction(value);
      if (result.success) {
        const chosen = new Set(selected.map((p) => p.id));
        setResults(result.data.filter((p) => !chosen.has(p.id)));
      }
    });
  }

  function add(player: PublicProfile) {
    onChange([...selected, player]);
    setQuery("");
    setResults([]);
  }

  function remove(playerId: string) {
    onChange(selected.filter((p) => p.id !== playerId));
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
          Who&apos;s playing?
        </p>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search players by name"
          aria-label="Search players by name"
          className="w-full rounded-lg border border-border bg-background py-2 pr-9 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {isSearching && (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1">
          {results.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => add(player)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                  {(player.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate text-foreground">{player.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && !isSearching && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No players found. They need an AIR/Rally account to be added.</p>
      )}

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-1.5 rounded-full bg-accent py-1 pr-1 pl-2.5 text-xs font-medium text-accent-foreground"
            >
              {player.display_name}
              <button
                type="button"
                onClick={() => remove(player.id)}
                aria-label={`Remove ${player.display_name}`}
                className="grid size-4 place-items-center rounded-full transition-colors hover:bg-foreground/10"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The share preview. Deliberately explicit that this is information,
          not a charge — nobody is billed through AIR/Rally but the payer. */}
      {selected.length > 0 && totalAmount > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{formatShare(split.sharePerPlayer, currency)}</span> each if you split it{" "}
            {split.playerCount} ways
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You pay the venue in full. Settling up with your group is between you — AIR/Rally doesn&apos;t collect from them.
          </p>
        </div>
      )}
    </div>
  );
}
