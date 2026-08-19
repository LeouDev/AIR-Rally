import Image from "next/image";
import { tierBadgeSrc, tierInfo } from "@/lib/ranked";
import type { RankedTier } from "@/lib/supabase/types";

const SIZES = { sm: 34, md: 56, lg: 86, xl: 128 } as const;

/** The one badge image, ink-swapped for the surface it sits on. */
export function RankBadge({
  tier,
  on = "light",
  size = "md",
  className,
}: {
  tier: RankedTier;
  /** Which surface this renders on — picks the ink-swapped variant, not just a filter. */
  on?: "light" | "navy";
  size?: keyof typeof SIZES | number;
  className?: string;
}) {
  const px = typeof size === "number" ? size : SIZES[size];
  const info = tierInfo(tier);
  return (
    <Image
      src={tierBadgeSrc(tier, on)}
      alt={`${info.name} badge`}
      width={px}
      height={px}
      className={className}
      unoptimized
    />
  );
}
