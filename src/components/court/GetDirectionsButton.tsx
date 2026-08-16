"use client";

import { useState } from "react";
import { Navigation, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildDirectionsUrls, detectPlatform, getPreferredDirectionsUrl } from "@/lib/services/directions";

type GetDirectionsButtonProps = {
  latitude: number | null;
  longitude: number | null;
  venueName: string;
};

/**
 * Primary tap opens the platform-preferred provider directly (one tap
 * for the large majority of visitors); the chevron opens the other two
 * explicit choices, since the brief names all three providers. Renders
 * nothing when the venue has no coordinates — matches the Location
 * section's own MapPlaceholder fallback posture.
 */
export function GetDirectionsButton({ latitude, longitude, venueName }: GetDirectionsButtonProps) {
  // Lazy initializer, not an effect — navigator.userAgent is read once at
  // mount; a brief "other" default during SSR (no navigator there) is
  // harmless since this only affects which provider a tap opens, not
  // what's rendered.
  const [platform] = useState(() => detectPlatform(typeof navigator !== "undefined" ? navigator.userAgent : ""));

  if (latitude === null || longitude === null) return null;

  const urls = buildDirectionsUrls(latitude, longitude, venueName);
  const preferredUrl = getPreferredDirectionsUrl(urls, platform);

  return (
    <div className="inline-flex">
      <Button asChild size="sm" className="rounded-r-none">
        <a href={preferredUrl} target="_blank" rel="noopener noreferrer">
          <Navigation className="size-4" aria-hidden="true" />
          Get Directions
        </a>
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" aria-label="More direction options" className="rounded-l-none border-l border-primary-foreground/20 px-2">
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          <a href={urls.google} target="_blank" rel="noopener noreferrer" className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
            Google Maps
          </a>
          <a href={urls.apple} target="_blank" rel="noopener noreferrer" className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
            Apple Maps
          </a>
          <a href={urls.waze} target="_blank" rel="noopener noreferrer" className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
            Waze
          </a>
        </PopoverContent>
      </Popover>
    </div>
  );
}
