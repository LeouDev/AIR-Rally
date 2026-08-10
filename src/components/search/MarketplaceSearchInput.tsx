"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";

const SEARCH_DEBOUNCE_MS = 400;

/** Debounced so typing doesn't re-run the server search on every keystroke. */
export function MarketplaceSearchInput({ className }: { className?: string }) {
  const { searchParams } = useExploreFilters();
  // Remounting on URL change (Reset, browser back/forward) resets the
  // local `value` state to match the new `filters.q` — same effect as the
  // sync-effect this replaces, without a synchronous setState-in-effect.
  return <SearchField key={searchParams.toString()} className={className} />;
}

function SearchField({ className }: { className?: string }) {
  const { filters, applyFilters } = useExploreFilters();
  const [value, setValue] = useState(filters.q ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (value !== (filters.q ?? "")) {
        applyFilters({ q: value || undefined });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by venue or court name…"
          aria-label="Search courts"
          className="pl-9"
        />
      </div>
    </div>
  );
}
