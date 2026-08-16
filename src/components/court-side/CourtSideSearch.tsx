"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { searchClubs } from "@/lib/services/clubs";
import type { Club } from "@/lib/supabase/types";

const DEBOUNCE_MS = 250;

/**
 * The COURT/Side rail search. Searches clubs by name — reads run through
 * the browser Supabase client, the same precedent FeaturedCourtsGrid and
 * the mention picker already use, with RLS deciding which clubs are
 * visible to this viewer.
 */
export function CourtSideSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Club[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Both the "searching" flag and the clear-on-empty happen here rather
  // than in the effect, so the effect never calls setState synchronously
  // in its own body (react-hooks/set-state-in-effect).
  function handleChange(value: string) {
    setQuery(value);
    setOpen(Boolean(value.trim()));
    setSearching(Boolean(value.trim()));
    if (!value.trim()) setResults([]);
  }

  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;

    const handle = setTimeout(() => {
      const supabase = createClient();
      searchClubs(supabase, query)
        .then((clubs) => {
          if (!cancelled) {
            setResults(clubs);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  // Clicking anywhere else dismisses the results without clearing the term.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(Boolean(query.trim()))}
          placeholder="Search clubs"
          aria-label="Search clubs"
          className="h-6 border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {searching ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">No clubs match “{query.trim()}”.</p>
          ) : (
            <ul>
              {results.map((club) => (
                <li key={club.id}>
                  <Link
                    href={`/clubs/${club.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate font-medium text-foreground">{club.name}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3" aria-hidden="true" />
                      {club.member_count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
