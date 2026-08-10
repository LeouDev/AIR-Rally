"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { parseExploreFilters, filtersToSearchParams } from "@/lib/explore-params";
import type { MarketplaceFilters } from "@/lib/services/venues";

/**
 * Shared by every Explore control (FilterBar, the search box, the sort
 * select) so each one doesn't reimplement "read filters from the URL,
 * write an updated set back" — the URL is the single source of truth for
 * filter state (see lib/explore-params.ts), not React state, so results
 * stay shareable/bookmarkable and survive back/forward navigation.
 */
export function useExploreFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseExploreFilters(Object.fromEntries(searchParams.entries()));

  function applyFilters(partial: Partial<MarketplaceFilters>) {
    // Any filter change resets to page 1 — staying on page 5 of a
    // suddenly-3-page result set would just show an empty page.
    const next: MarketplaceFilters = { ...filters, ...partial, page: undefined };
    const params = filtersToSearchParams(next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function goToPage(page: number) {
    const params = filtersToSearchParams({ ...filters, page });
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { filters, applyFilters, goToPage, searchParams, pathname };
}
