"use client";

import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { cn } from "@/lib/utils";

type FavoriteButtonProps = {
  courtId: string;
  courtName: string;
  className?: string;
};

export function FavoriteButton({ courtId, courtName, className }: FavoriteButtonProps) {
  const isFavorite = useFavoritesStore((s) => s.isFavorite(courtId));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.85 }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(courtId);
      }}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Remove ${courtName} from favorites` : `Save ${courtName} to favorites`}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      <Heart
        className={cn(
          "size-4.5 transition-colors",
          isFavorite ? "fill-destructive text-destructive" : "text-foreground"
        )}
        aria-hidden="true"
      />
    </motion.button>
  );
}
