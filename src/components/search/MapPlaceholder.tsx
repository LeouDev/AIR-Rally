import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

type MapPlaceholderProps = {
  className?: string;
  resultCount?: number;
};

/**
 * Static stand-in for a real map. No provider is wired up yet — see
 * lib/services/maps.ts. Swap this component's contents for a live
 * Google Maps / Mapbox view once a provider is implemented there.
 */
export function MapPlaceholder({ className, resultCount }: MapPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted",
        className
      )}
    >
      <svg className="absolute inset-0 size-full opacity-40" aria-hidden="true">
        <defs>
          <pattern id="map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="currentColor" strokeWidth="1" className="text-border" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#map-grid)" />
      </svg>
      <div className="relative flex flex-col items-center gap-2 px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-background text-primary shadow-sm">
          <MapPin className="size-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-foreground">Map view coming soon</p>
        <p className="text-xs text-muted-foreground">
          {resultCount !== undefined
            ? `${resultCount} court${resultCount === 1 ? "" : "s"} nearby`
            : "Live location search arrives in a later phase"}
        </p>
      </div>
    </div>
  );
}
