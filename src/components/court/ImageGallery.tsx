"use client";

import { useState } from "react";
import Image from "next/image";
import { CourtSurface } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";
import type { CourtSurfaceColor } from "@/types/court";

export type GalleryImage = { url: string; alt: string };

type ImageGalleryProps = {
  images: GalleryImage[];
  venueName: string;
  fallbackSurfaceColor: CourtSurfaceColor;
  indoor: boolean;
};

/**
 * Falls back to the illustrated court surface when a venue has no real
 * photos — which is every venue today, since no upload UI exists yet
 * (see ARCHITECTURE.md). `images` is real when it's non-empty: real
 * Storage URLs, resolved server-side before reaching this component.
 */
export function ImageGallery({ images, venueName, fallbackSurfaceColor, indoor }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border">
        <CourtSurface surfaceColor={fallbackSurfaceColor} indoor={indoor} />
      </div>
    );
  }

  const active = images[activeIndex];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border">
        <Image src={active.url} alt={active.alt || venueName} fill sizes="(min-width: 1024px) 800px, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <div className="flex gap-3" role="tablist" aria-label={`${venueName} photos`}>
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Show photo ${index + 1} of ${images.length}`}
              onClick={() => setActiveIndex(index)}
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                index === activeIndex ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <Image src={image.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
