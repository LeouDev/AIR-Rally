"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PhotoCarousel, type CarouselImage } from "@/components/shared/PhotoCarousel";

/**
 * Full-viewport swipeable viewer, opened at a specific photo. Shared by
 * the public court gallery and the owner's photo manager, so "view a
 * photo" behaves identically everywhere in the app. Fully controlled —
 * the caller already owns "which photo is active" state (it needed that
 * to know which photo was clicked to open this in the first place), so
 * this has no state of its own to keep in sync.
 */
export function PhotoLightbox({
  images,
  activeIndex,
  onIndexChange,
  open,
  onOpenChange,
  title,
}: {
  images: CarouselImage[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-2 p-2 sm:p-3" showCloseButton>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <PhotoCarousel
          images={images}
          activeIndex={activeIndex}
          onChange={onIndexChange}
          className="aspect-[4/3] w-full rounded-lg sm:aspect-[16/10]"
          imageSizes="(min-width: 640px) 900px, 100vw"
        />
        {images.length > 1 && (
          <p className="text-center text-xs text-muted-foreground">
            {activeIndex + 1} / {images.length}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
