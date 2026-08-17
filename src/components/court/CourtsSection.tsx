import Image from "next/image";
import { CourtSurface, deterministicSurfaceColor } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";
import type { Court } from "@/lib/supabase/types";
import type { CustomerAvailabilitySlot } from "@/lib/services/customerAvailability";

const STATUS_DOT: Record<CustomerAvailabilitySlot["status"], string> = {
  available: "bg-success",
  unavailable: "bg-muted-foreground/30",
  closed: "bg-border",
};

const STATUS_LABEL: Record<CustomerAvailabilitySlot["status"], string> = {
  available: "Available",
  unavailable: "Unavailable",
  closed: "Closed",
};

function formatSlotTime(localTime: string): string {
  const [hourStr, minute] = localTime.split(":");
  const hour = Number(hourStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

/**
 * A compact heatmap-style strip, not a full schedule — a quick-glance
 * credibility signal ("this place has real openings today") before a
 * visitor commits to opening BookingWidget's own date/time picker,
 * which remains the actual booking flow, unchanged.
 */
function CourtAvailabilityStrip({ slots }: { slots: CustomerAvailabilitySlot[] }) {
  if (slots.length === 0) {
    return <p className="text-xs text-muted-foreground">No operating hours set for today.</p>;
  }

  const availableCount = slots.filter((slot) => slot.status === "available").length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1" role="img" aria-label={`Today's availability: ${availableCount} of ${slots.length} slots open`}>
        {slots.map((slot) => (
          <span
            key={slot.localTime}
            title={`${formatSlotTime(slot.localTime)} · ${STATUS_LABEL[slot.status]}`}
            className={cn("h-4 w-2.5 rounded-sm", STATUS_DOT[slot.status])}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {availableCount > 0 ? `${availableCount} slot${availableCount === 1 ? "" : "s"} open today` : "No availability left today"}
      </p>
    </div>
  );
}

export type CourtWithThumbnail = Court & { imageUrl: string | null };

export function CourtsSection({
  courts,
  availabilityByCourt,
}: {
  courts: CourtWithThumbnail[];
  availabilityByCourt: Record<string, CustomerAvailabilitySlot[]>;
}) {
  if (courts.length === 0) {
    return <p className="text-sm text-muted-foreground">No courts listed yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {courts.map((court) => (
        <div key={court.id} className="flex gap-3.5 rounded-lg bg-card p-3.5 shadow-card">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-md">
            {court.imageUrl ? (
              <Image src={court.imageUrl} alt={court.name} fill sizes="80px" className="object-cover" />
            ) : (
              <CourtSurface surfaceColor={deterministicSurfaceColor(court.id)} indoor={court.indoor_outdoor === "indoor"} />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base/[1.375rem] font-semibold text-foreground">{court.name}</h3>
                {/* Surface and type read as plain facts, not as filter chips —
                    nothing here is selectable, and badges implied it was. */}
                <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                  {[court.indoor_outdoor === "indoor" ? "Indoor" : "Outdoor", court.surface_type]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="shrink-0 font-mono text-base/[1.375rem] font-semibold text-foreground">
                ₱{court.hourly_price}
                <span className="font-sans text-xs/4 font-normal text-muted-foreground">/hr</span>
              </p>
            </div>
            {court.description && (
              <p className="text-[0.8125rem]/[1.125rem] text-subtle">{court.description}</p>
            )}
            <CourtAvailabilityStrip slots={availabilityByCourt[court.id] ?? []} />
          </div>
        </div>
      ))}
    </div>
  );
}
