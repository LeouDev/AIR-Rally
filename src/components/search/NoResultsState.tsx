"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { RequestVenueForm } from "@/components/search/RequestVenueForm";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import { CLEAR_ALL_FILTERS, describeActiveFilters } from "@/lib/explore-params";
import type { Amenity } from "@/lib/supabase/types";

const SPELLED_OUT = ["zero", "one", "two", "three", "four", "five", "six"];

/**
 * "No results" is the one screen that has to name its own cause. Saying how
 * many filters are responsible — and putting the undo next to it — is the
 * difference between a dead end and a two-tap recovery.
 */
export function NoResultsState({ amenities, isSignedIn }: { amenities: Amenity[]; isSignedIn: boolean }) {
  const { filters, applyFilters } = useExploreFilters();
  const amenityNames = new Map(amenities.map((amenity) => [amenity.id, amenity.name]));
  const activeChips = describeActiveFilters(filters, amenityNames);
  const count = activeChips.length;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Preserve exactly what the visitor was searching for — someone who signs
  // in to ask for a venue and lands back on an empty, unfiltered /explore
  // has lost their place.
  const currentUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;

  // Only the SUBMISSION needs an account (the notification promise needs
  // somewhere to send it) — the empty state and the ask itself are visible
  // to everyone, since a visitor with no account is exactly who this is
  // meant to catch on their way toward signing up. Not the full-page
  // SignInGate: that pattern is for "this whole page is private," which
  // this isn't — only the form's submit button is gated.
  const requestVenue = isSignedIn ? (
    <RequestVenueForm />
  ) : (
    <div className="mt-4 flex flex-col items-center gap-2">
      <p className="text-sm text-muted-foreground">Want us to bring a court here?</p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/login?redirect=${encodeURIComponent(currentUrl)}`}>Sign in to ask for a venue</Link>
      </Button>
    </div>
  );

  if (count === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No courts match your search"
        description="Try a different search term, or widen your search to a nearby city."
        action={requestVenue}
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
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => applyFilters(CLEAR_ALL_FILTERS)}>
            Clear {count === 1 ? "filter" : "all filters"}
          </Button>
          {requestVenue}
        </div>
      }
    />
  );
}
