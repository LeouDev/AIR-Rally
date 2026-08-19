"use client";

import { useState } from "react";
import Image from "next/image";
import { CourtSurface } from "@/components/court/CourtSurface";
import { PhotoCarousel, type CarouselImage } from "@/components/shared/PhotoCarousel";
import { PhotoLightbox } from "@/components/shared/PhotoLightbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { CourtSurfaceColor } from "@/types/court";

export type GalleryImage = CarouselImage;

type ImageGalleryProps = {
  images: GalleryImage[];
  venueName: string;
  fallbackSurfaceColor: CourtSurfaceColor;
  indoor: boolean;
};

const MAX_GRID_CELLS = 4;

/**
 * Falls back to the illustrated court surface when a venue has no real
 * photos. On mobile, a single swipeable photo (same interaction as the
 * lightbox). On tablet/desktop, an Airbnb-style hero + up-to-4-photo
 * grid — clicking any tile opens the same swipeable PhotoLightbox at
 * that photo, with a "+N" overlay on the last tile when there are more
 * photos than fit in the grid.
 */
export function ImageGallery({ images, venueName, fallbackSurfaceColor, indoor }: ImageGalleryProps) {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  // Which grid/hero photo URLs have actually finished loading — a real
  // signal from next/image's own onLoad, not a fixed timer. Court detail
  // pages load several full-size photos at once on first navigation; a
  // live-site audit found this area sits fully blank (no placeholder at
  // all, just background-colored empty space) for close to a second on a
  // cold load. The pulse below fills that exact window and disappears
  // the instant each image is actually ready, never lingering under an
  // already-loaded photo.
  const [loadedUrls, setLoadedUrls] = useState<Set<string>>(() => new Set());
  function markLoaded(url: string) {
    setLoadedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }

  if (images.length === 0) {
    return (
      <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border">
        <CourtSurface surfaceColor={fallbackSurfaceColor} indoor={indoor} />
      </div>
    );
  }

  function openLightbox(index: number) {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }

  const gridCells = images.slice(1, 1 + MAX_GRID_CELLS);
  const remaining = images.length - 1 - gridCells.length;

  return (
    <>
      <div className="sm:hidden">
        <PhotoCarousel
          images={images}
          activeIndex={carouselIndex}
          onChange={setCarouselIndex}
          className="aspect-[4/3] w-full rounded-2xl border border-border"
        />
      </div>

      {images.length === 1 ? (
        <button
          type="button"
          onClick={() => openLightbox(0)}
          className="relative hidden aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border sm:block"
        >
          {!loadedUrls.has(images[0].url) && <Skeleton className="absolute inset-0 rounded-none" />}
          <Image
            src={images[0].url}
            alt={images[0].alt || venueName}
            fill
            sizes="1152px"
            className="object-cover"
            onLoad={() => markLoaded(images[0].url)}
          />
        </button>
      ) : (
        <div className="hidden gap-1 overflow-hidden rounded-2xl border border-border bg-muted sm:grid sm:h-96 sm:grid-cols-4 sm:grid-rows-2">
          <button
            type="button"
            onClick={() => openLightbox(0)}
            className="relative col-span-2 row-span-2 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            {!loadedUrls.has(images[0].url) && <Skeleton className="absolute inset-0 rounded-none" />}
            <Image
              src={images[0].url}
              alt={images[0].alt || venueName}
              fill
              sizes="(min-width: 1024px) 576px, 50vw"
              className="object-cover transition-transform duration-200 hover:scale-105"
              onLoad={() => markLoaded(images[0].url)}
            />
          </button>
          {gridCells.map((image, i) => {
            const isLastVisible = i === gridCells.length - 1;
            return (
              <button
                key={image.url}
                type="button"
                onClick={() => openLightbox(i + 1)}
                className="relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                {!loadedUrls.has(image.url) && <Skeleton className="absolute inset-0 rounded-none" />}
                <Image
                  src={image.url}
                  alt={image.alt || venueName}
                  fill
                  sizes="(min-width: 1024px) 288px, 25vw"
                  className="object-cover transition-transform duration-200 hover:scale-105"
                  onLoad={() => markLoaded(image.url)}
                />
                {isLastVisible && remaining > 0 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
                    +{remaining}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <PhotoLightbox
        images={images}
        activeIndex={lightboxIndex}
        onIndexChange={setLightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        title={`${venueName} photos`}
      />
    </>
  );
}
