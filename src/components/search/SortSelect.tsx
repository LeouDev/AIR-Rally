"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import type { VenueSortOption } from "@/lib/services/venues";

const SORT_LABELS: Record<VenueSortOption, string> = {
  recommended: "Recommended",
  price_asc: "Price: Low to High",
  price_desc: "Price: High to Low",
  rating: "Highest Rated",
};

export function SortSelect() {
  const { filters, applyFilters } = useExploreFilters();
  const sort = filters.sort ?? "recommended";

  return (
    <Select value={sort} onValueChange={(value) => applyFilters({ sort: value as VenueSortOption })}>
      <SelectTrigger className="w-[190px]" aria-label="Sort results">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABELS) as VenueSortOption[]).map((option) => (
          <SelectItem key={option} value={option}>
            {SORT_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
