import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RankedMode } from "@/lib/supabase/types";

/**
 * Singles/doubles switch for a server-rendered Ranked page — a plain
 * link pair (`?mode=singles` / `?mode=doubles`), not client state, since
 * every page that uses this fetches mode-specific data server-side.
 * Doesn't exist before this file: singles and doubles only became two
 * independent standings with the DUPR-inspired rating engine
 * (20260810000068_dupr_rating_engine.sql) — before that there was one
 * shared rating and nothing to switch between.
 */
export function ModeTabs({ current, basePath }: { current: RankedMode; basePath: string }) {
  const modes: RankedMode[] = ["singles", "doubles"];
  return (
    <div className="grid grid-cols-2 border-2 border-navy">
      {modes.map((mode, i) => (
        <Link
          key={mode}
          href={`${basePath}?mode=${mode}`}
          className={cn(
            "border-navy px-4 py-2.5 text-center text-[0.75rem] font-bold tracking-[0.1em] uppercase transition-colors",
            i === 0 && "border-r-2",
            current === mode ? "bg-navy text-navy-foreground" : "bg-transparent text-navy hover:bg-navy/5"
          )}
        >
          {mode}
        </Link>
      ))}
    </div>
  );
}

/** Reads `?mode=` from a page's searchParams, defaulting to singles. */
export function parseMode(value: string | undefined): RankedMode {
  return value === "doubles" ? "doubles" : "singles";
}
