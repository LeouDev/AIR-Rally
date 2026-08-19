import { pipRow } from "@/lib/ranked";
import { cn } from "@/lib/utils";
import type { RankedPips } from "@/lib/supabase/types";

/**
 * The ladder's whole visual grammar: five diamonds (rotated squares),
 * filled left to right. Matches the design's pip treatment exactly —
 * `rotate-45` squares, not a dot or a star.
 */
export function PipRow({
  pips,
  on = "light",
  size = "md",
  className,
}: {
  pips: RankedPips;
  on?: "light" | "navy";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "sm" ? 8 : size === "lg" ? 16 : 11;
  const border = size === "lg" ? "border-2" : "border";
  const filled = on === "navy" ? "bg-navy-foreground border-navy-foreground" : "bg-rally border-rally";
  const empty = on === "navy" ? "border-navy-foreground/60" : "border-navy/50";

  return (
    <div className={cn("flex items-center gap-1.5", className)} role="img" aria-label={`${pips} of 5 pips`}>
      {pipRow(pips).map((state, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn("rotate-45", border, state === "filled" ? filled : cn("bg-transparent", empty))}
          style={{ width: px, height: px }}
        />
      ))}
    </div>
  );
}
