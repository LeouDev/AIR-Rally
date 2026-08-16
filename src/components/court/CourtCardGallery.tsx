"use client";

import { useState } from "react";
import { PhotoCarousel, type CarouselImage } from "@/components/shared/PhotoCarousel";
import { CourtSurface } from "@/components/court/CourtSurface";
import type { CourtSurfaceColor } from "@/types/court";

/**
 * The card's hero image, swipeable when there's more than one real
 * photo — the venue's cover photo plus any of its courts' own photos,
 * combined into one gallery instead of a separate thumbnail strip below
 * the price. Falls back to the illustration only when there are zero
 * real photos at all, matching ImageGallery's own fallback posture on
 * the full Court Details page.
 */
export function CourtCardGallery({
  images,
  fallbackSurfaceColor,
  indoor,
}: {
  images: CarouselImage[];
  fallbackSurfaceColor: CourtSurfaceColor;
  indoor: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return <CourtSurface surfaceColor={fallbackSurfaceColor} indoor={indoor} />;
  }

  return <PhotoCarousel images={images} activeIndex={activeIndex} onChange={setActiveIndex} className="size-full" imageSizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw" />;
}
