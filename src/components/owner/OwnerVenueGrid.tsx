import { OwnerVenueCard } from "@/components/owner/OwnerVenueCard";
import type { OwnerVenueSummary } from "@/lib/services/venues";

export function OwnerVenueGrid({ venues }: { venues: OwnerVenueSummary[] }) {
  if (venues.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">Your venues</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {venues.map((venue) => (
          <OwnerVenueCard key={venue.id} venue={venue} />
        ))}
      </div>
    </div>
  );
}
