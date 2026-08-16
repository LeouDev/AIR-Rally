import Link from "next/link";
import { MapPin, Sun, Home, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Rating } from "@/components/court/Rating";
import { FavoriteButton } from "@/components/court/FavoriteButton";
import { CourtCardGallery } from "@/components/court/CourtCardGallery";
import { deterministicSurfaceColor } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";
import type { IndoorOutdoor } from "@/lib/supabase/types";

/**
 * Deliberately not `VenueMarketplaceRow` directly — this is the minimal
 * shape the card actually renders, so any page that has *a* venue-like
 * object (the marketplace view, a single-venue detail fetch, a future
 * search-result shape) can hand it over without over-fetching or
 * reshaping to match a wider type than the card needs. Explore/
 * Featured/Favorites all build this via exploreCards.ts#toVenueCardData
 * rather than mapping it inline three separate times.
 */
export type VenueCardData = {
  id: string;
  name: string;
  city: string | null;
  indoorOutdoor: IndoorOutdoor;
  averageRating: number;
  reviewCount: number;
  startingPrice: number | null;
  activeCourtCount: number;
  /** Already-resolved public URL, or null/undefined to fall back to the illustration. */
  coverImageUrl?: string | null;
  /** Up to a few active courts' own photos (null per-court when that court has none). Merged with coverImageUrl into one swipeable gallery — see the imageUrl-filtering in CourtCard itself. */
  courtThumbnails?: { id: string; imageUrl: string | null; surfaceType: string | null }[];
  /** Computed purely from operating hours, no booking lookups — see computeOpenStatus(). */
  openStatus?: { isOpenNow: boolean; label: string };
  /** Null until the venue's address has been successfully geocoded — see lib/services/geocoding.ts. */
  latitude?: number | null;
  longitude?: number | null;
};

type CourtCardProps = {
  venue: VenueCardData;
  isFavorited?: boolean;
};

export function CourtCard({ venue, isFavorited = false }: CourtCardProps) {
  const isIndoor = venue.indoorOutdoor === "indoor";
  const isOutdoor = venue.indoorOutdoor === "outdoor";

  // Cover photo first, then each court's own photo — one swipeable
  // gallery instead of a cover photo plus a separate thumbnail strip.
  // Only real uploaded photos go in; a court with no photo just isn't a
  // slide (no illustrated swatch mixed in with real photography).
  const galleryImages: { url: string; alt: string }[] = [];
  if (venue.coverImageUrl) {
    galleryImages.push({ url: venue.coverImageUrl, alt: venue.name });
  }
  for (const court of venue.courtThumbnails ?? []) {
    if (court.imageUrl && !galleryImages.some((image) => image.url === court.imageUrl)) {
      galleryImages.push({ url: court.imageUrl, alt: venue.name });
    }
  }

  return (
    <Link
      href={`/courts/${venue.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <div className="relative size-full transition-transform duration-300 group-hover:scale-105">
          <CourtCardGallery images={galleryImages} fallbackSurfaceColor={deterministicSurfaceColor(venue.id)} indoor={isIndoor} />
        </div>
        <div className="absolute top-3 left-3">
          <Badge variant="secondary" className="gap-1 bg-background/90 text-foreground backdrop-blur">
            {isIndoor ? <Home className="size-3" /> : isOutdoor ? <Sun className="size-3" /> : <Layers className="size-3" />}
            {venue.indoorOutdoor === "both" ? "Indoor & Outdoor" : isIndoor ? "Indoor" : "Outdoor"}
          </Badge>
        </div>
        <div className="absolute top-3 right-3">
          <FavoriteButton venueId={venue.id} venueName={venue.name} initialFavorited={isFavorited} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground group-hover:text-primary">
            {venue.name}
          </h3>
          <Rating value={venue.averageRating} reviewCount={venue.reviewCount} />
        </div>
        {venue.city && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {venue.city}
          </p>
        )}
        {venue.openStatus && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", venue.openStatus.isOpenNow ? "bg-success" : "bg-muted-foreground/40")}
              aria-hidden="true"
            />
            {venue.openStatus.label}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            {venue.startingPrice !== null ? (
              <>
                <span className="text-base font-semibold text-foreground">₱{venue.startingPrice}</span> / hour
              </>
            ) : (
              "Pricing unavailable"
            )}
            {venue.activeCourtCount > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                · {venue.activeCourtCount} court{venue.activeCourtCount === 1 ? "" : "s"}
              </span>
            )}
          </p>
          <span className="text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            View court →
          </span>
        </div>
      </div>
    </Link>
  );
}
