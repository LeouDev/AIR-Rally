"use client";

import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import { CLEAR_ALL_FILTERS, describeActiveFilters } from "@/lib/explore-params";
import type { Amenity } from "@/lib/supabase/types";

const SPELLED_OUT = ["zero", "one", "two", "three", "four", "five", "six"];

/**
 * "No results" is the one screen that has to name its own cause. Saying how
 * many filters are responsible — and putting the undo next to it — is the
 * difference between a dead end and a two-tap recovery.
 */
export function NoResultsState({ amenities }: { amenities: Amenity[] }) {
  const { filters, applyFilters } = useExploreFilters();
  const amenityNames = new Map(amenities.map((amenity) => [amenity.id, amenity.name]));
  const activeChips = describeActiveFilters(filters, amenityNames);
  const count = activeChips.length;

  if (count === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No courts match your search"
        description="Try a different search term, or widen your search to a nearby city."
      />
    );
  }

  const filterPhrase =
    count === 1 ? "that filter" : `all ${SPELLED_OUT[count] ?? count} filters`;

  return (
    <EmptyState
      icon={SearchX}
      title={`No courts match ${filterPhrase}`}
      description={
        count === 1
          ? "Remove it to see everything nearby, or try a different search term."
          : "Removing one at a time usually finds something — the chips above are individually removable."
      }
      action={
        <Button onClick={() => applyFilters(CLEAR_ALL_FILTERS)}>
          Clear {count === 1 ? "filter" : "all filters"}
        </Button>
      }
    />
  );
}
