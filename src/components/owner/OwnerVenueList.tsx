import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Venue, VenueStatus } from "@/lib/supabase/types";

const STATUS_STYLES: Record<VenueStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-warning/15 text-warning",
  active: "bg-success/15 text-success",
  suspended: "bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<VenueStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  active: "Active",
  suspended: "Suspended",
};

export function OwnerVenueList({ venues }: { venues: Venue[] }) {
  if (venues.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">Your venues</h2>
      <ul className="flex flex-col gap-3">
        {venues.map((venue) => (
          <li
            key={venue.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{venue.name}</p>
              {venue.city && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" aria-hidden="true" />
                  {venue.city}
                </p>
              )}
            </div>
            <Badge className={cn("border-transparent", STATUS_STYLES[venue.status])}>
              {STATUS_LABELS[venue.status]}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
