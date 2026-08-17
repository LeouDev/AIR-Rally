import Link from "next/link";
import { MapPin, Star } from "lucide-react";
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
      className="group flex flex-col overflow-hidden rounded-xl bg-card shadow-card transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <div className="relative size-full transition-transform duration-300 group-hover:scale-105">
          <CourtCardGallery images={galleryImages} fallbackSurfaceColor={deterministicSurfaceColor(venue.id)} indoor={isIndoor} />
        </div>
        {/* Open-now sits on the photo, not under the title: whether you can play
            tonight decides the tap, so it should be readable before the name. */}
        {venue.openStatus && (
          <div className="absolute top-3 left-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full bg-card/92 px-2.5 py-1 text-xs/4 font-medium backdrop-blur-sm",
                venue.openStatus.isOpenNow ? "text-foreground" : "text-subtle"
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  venue.openStatus.isOpenNow ? "bg-success" : "bg-destructive"
                )}
                aria-hidden="true"
              />
              {venue.openStatus.label}
            </span>
          </div>
        )}
        <div className="absolute top-3 right-3">
          <FavoriteButton venueId={venue.id} venueName={venue.name} initialFavorited={isFavorited} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3.5">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-[1.0625rem]/[1.375rem] font-semibold text-foreground">
            {venue.name}
          </h3>
          {venue.reviewCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-sm/5 font-medium text-foreground">
              <Star className="size-3.5 fill-primary text-primary" aria-hidden="true" />
              {venue.averageRating.toFixed(1)}
            </span>
          ) : (
            <span className="shrink-0 text-[0.8125rem]/5 text-muted-foreground">New</span>
          )}
        </div>
        {venue.city && (
          <p className="flex items-center gap-1 text-sm/5 text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {venue.city}
          </p>
        )}
        <p className="mt-0.5 text-sm/5 text-muted-foreground">
          {venue.startingPrice !== null ? (
            <>
              <span className="font-mono text-base/6 font-semibold text-foreground">
                ₱{venue.startingPrice}
              </span>{" "}
              / hour
            </>
          ) : (
            <span>Pricing unavailable</span>
          )}
          {venue.activeCourtCount > 0 && (
            <> · {venue.activeCourtCount} court{venue.activeCourtCount === 1 ? "" : "s"}</>
          )}
        </p>
      </div>
    </Link>
  );
}
