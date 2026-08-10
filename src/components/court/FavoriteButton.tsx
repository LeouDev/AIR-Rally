"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { toggleFavoriteAction } from "@/lib/actions/favorites";
import { cn } from "@/lib/utils";

type FavoriteButtonProps = {
  venueId: string;
  venueName: string;
  initialFavorited: boolean;
  className?: string;
};

export function FavoriteButton({ venueId, venueName, initialFavorited, className }: FavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (isPending) return;

    const previous = isFavorited;
    setIsFavorited(!previous); // optimistic — reverted below on failure

    startTransition(async () => {
      const result = await toggleFavoriteAction(venueId, previous);
      if (!result.success) {
        setIsFavorited(previous);
        if (result.error.toLowerCase().includes("sign in")) {
          toast.error(result.error, {
            action: {
              label: "Sign in",
              onClick: () => router.push(`/login?redirect=${encodeURIComponent(pathname)}`),
            },
          });
        } else {
          toast.error(result.error);
        }
        return;
      }
      router.refresh();
    });
  }

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.85 }}
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isFavorited}
      aria-label={isFavorited ? `Remove ${venueName} from favorites` : `Save ${venueName} to favorites`}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-70",
        className
      )}
    >
      <Heart
        className={cn(
          "size-4.5 transition-colors",
          isFavorited ? "fill-destructive text-destructive" : "text-foreground"
        )}
        aria-hidden="true"
      />
    </motion.button>
  );
}
