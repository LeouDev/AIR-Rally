import { OwnerVenueCard } from "@/components/owner/OwnerVenueCard";
import type { OwnerVenueSummary } from "@/lib/services/venues";

export function OwnerVenueGrid({ venues }: { venues: OwnerVenueSummary[] }) {
  if (venues.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
        You haven&apos;t added any venues yet. Click &ldquo;Add Venue&rdquo; to get started.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {venues.map((venue) => (
        <OwnerVenueCard key={venue.id} venue={venue} />
      ))}
    </div>
  );
}
