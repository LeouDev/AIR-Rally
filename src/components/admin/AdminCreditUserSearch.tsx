"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { searchPlayersAction } from "@/lib/actions/profile";
import type { PublicProfile } from "@/lib/supabase/types";

/**
 * Finds the player whose balance an admin needs to adjust.
 *
 * Reuses searchPlayersAction rather than adding an admin-only search:
 * it already resolves through the public_profiles view (profiles' own RLS
 * is read-your-own-row, so a direct query returns nothing for anyone but
 * the viewer), and there is no reason for admins to search a different
 * index than the rest of the app.
 */
export function AdminCreditUserSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searched, setSearched] = useState(false);
  const [isSearching, startSearch] = useTransition();

  function handleChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    startSearch(async () => {
      const result = await searchPlayersAction(value);
      setResults(result.success ? result.data : []);
      setSearched(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Input placeholder="Search by name…" value={query} onChange={(e) => handleChange(e.target.value)} />

      {isSearching && <p className="text-xs text-muted-foreground">Searching…</p>}

      {!isSearching && searched && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No players match that name.</p>
      )}

      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {results.map((player) => (
            <li key={player.id}>
              <Link
                href={`/admin/credits/${player.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent"
              >
                <span className="font-medium text-foreground">{player.display_name || "Player"}</span>
                <span className="text-xs text-muted-foreground">View credits</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
