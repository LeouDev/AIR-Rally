"use client";

import { useMemo, useState } from "react";
import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookingDetailDialog } from "@/components/owner/BookingDetailDialog";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/supabase/types";
import type { OwnerBookingWithDetails } from "@/lib/services/ownerBookings";

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-warning/15 text-warning",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** Groups the flat, already-sorted list into venue → court sections —
 * grouping is a rendering concern here, not a second query (the service
 * layer intentionally returns a flat list; see ownerBookings.ts). */
function groupByVenueThenCourt(bookings: OwnerBookingWithDetails[]) {
  const venues = new Map<string, { venueName: string; courts: Map<string, { courtName: string; bookings: OwnerBookingWithDetails[] }> }>();
  for (const booking of bookings) {
    if (!venues.has(booking.venueId)) {
      venues.set(booking.venueId, { venueName: booking.venueName, courts: new Map() });
    }
    const venue = venues.get(booking.venueId)!;
    if (!venue.courts.has(booking.courtId)) {
      venue.courts.set(booking.courtId, { courtName: booking.courtName, bookings: [] });
    }
    venue.courts.get(booking.courtId)!.bookings.push(booking);
  }
  return venues;
}

export function OwnerBookingsList({ bookings }: { bookings: OwnerBookingWithDetails[] }) {
  const [selected, setSelected] = useState<OwnerBookingWithDetails | null>(null);
  const grouped = useMemo(() => groupByVenueThenCourt(bookings), [bookings]);

  if (bookings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No bookings here yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {Array.from(grouped.entries()).map(([venueId, venue]) => (
        <div key={venueId} className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-foreground">{venue.venueName}</h2>
          {Array.from(venue.courts.entries()).map(([courtId, court]) => (
            <div key={courtId} className="rounded-2xl border border-border bg-card p-6">
              <h3 className="text-sm font-medium text-muted-foreground">{court.courtName}</h3>
              <ul className="mt-3 flex flex-col">
                {court.bookings.map((booking) => (
                  <li key={booking.id} className="border-b border-border/60 py-2.5 last:border-none">
                    <button
                      type="button"
                      onClick={() => setSelected(booking)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                    >
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <User className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        {booking.customerName}
                      </span>
                      <span className="text-sm text-muted-foreground">{formatDateTime(booking.startTime, booking.venueTimezone)}</span>
                      <Badge className={cn("border-transparent", STATUS_STYLES[booking.status])}>{STATUS_LABELS[booking.status]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      <BookingDetailDialog booking={selected} open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
