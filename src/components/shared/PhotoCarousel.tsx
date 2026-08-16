"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CarouselImage = { url: string; alt: string };

const SWIPE_THRESHOLD = 60;

/**
 * One image at a time, real touch/mouse drag to swipe (framer-motion,
 * already a dependency — no new package needed), directional slide
 * animation, arrow buttons, and dot indicators. Controlled by
 * `activeIndex`/`onChange` so a parent (ImageGallery's thumbnail strip,
 * a lightbox's own state) can stay in sync with which photo is showing.
 */
export function PhotoCarousel({
  images,
  activeIndex,
  onChange,
  className,
  imageSizes = "100vw",
  showControls = true,
}: {
  images: CarouselImage[];
  activeIndex: number;
  onChange: (index: number) => void;
  className?: string;
  imageSizes?: string;
  showControls?: boolean;
}) {
  const [direction, setDirection] = useState(0);

  function go(next: number) {
    if (images.length === 0) return;
    const clamped = (next + images.length) % images.length;
    if (clamped === activeIndex) return;
    setDirection(next > activeIndex ? 1 : -1);
    onChange(clamped);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_THRESHOLD) go(activeIndex + 1);
    else if (info.offset.x > SWIPE_THRESHOLD) go(activeIndex - 1);
  }

  if (images.length === 0) return null;
  const active = images[activeIndex];

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={activeIndex}
          custom={direction}
          initial={{ x: direction >= 0 ? "100%" : "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: direction >= 0 ? "-100%" : "100%", opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          drag={images.length > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.6}
          onDragEnd={handleDragEnd}
          className="absolute inset-0"
        >
          <Image src={active.url} alt={active.alt} fill sizes={imageSizes} className="pointer-events-none object-cover" draggable={false} />
        </motion.div>
      </AnimatePresence>

      {showControls && images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(activeIndex - 1)}
            className="absolute left-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(activeIndex + 1)}
            className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5" role="tablist" aria-label="Photos">
            {images.map((image, i) => (
              <button
                key={image.url}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Go to photo ${i + 1} of ${images.length}`}
                onClick={() => go(i)}
                className={cn("size-1.5 rounded-full transition-colors", i === activeIndex ? "bg-white" : "bg-white/50 hover:bg-white/75")}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
