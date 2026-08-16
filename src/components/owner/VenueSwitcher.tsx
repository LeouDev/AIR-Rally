"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SwitchableVenue = { id: string; name: string };

/**
 * Lets an owner with multiple venues jump straight to another venue's
 * calendar, instead of the Calendar nav tab silently always landing on
 * the same (first) venue with no way to tell others exist. Preserves
 * the current `date` query param across the switch, since checking the
 * same day across venues is the common reason to switch at all.
 */
export function VenueSwitcher({ venues, currentVenueId, date }: { venues: SwitchableVenue[]; currentVenueId: string; date: string }) {
  const router = useRouter();

  if (venues.length <= 1) return null;

  return (
    <Select
      value={currentVenueId}
      onValueChange={(nextVenueId) => router.push(`/list-your-court/${nextVenueId}/availability?date=${date}`)}
    >
      <SelectTrigger className="w-auto min-w-[180px]" aria-label="Switch venue">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {venues.map((venue) => (
          <SelectItem key={venue.id} value={venue.id}>
            {venue.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
