"use client";

import { useState } from "react";
import { CourtSurface } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";
import type { CourtImage } from "@/types/court";

type ImageGalleryProps = {
  images: CourtImage[];
  courtName: string;
};

export function ImageGallery({ images, courtName }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border">
        <CourtSurface surfaceColor={active.surfaceColor} indoor={active.indoor} />
      </div>
      {images.length > 1 && (
        <div className="flex gap-3" role="tablist" aria-label={`${courtName} photos`}>
          {images.map((image, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Show photo ${index + 1} of ${images.length}`}
              onClick={() => setActiveIndex(index)}
              className={cn(
                "size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                index === activeIndex ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <CourtSurface surfaceColor={image.surfaceColor} indoor={image.indoor} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
