import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type RatingProps = {
  value: number;
  reviewCount?: number;
  size?: "sm" | "md";
  className?: string;
};

export function Rating({ value, reviewCount, size = "sm", className }: RatingProps) {
  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  // A venue with no reviews is never "0.0 (0)" — that reads as a bad score
  // when it is really a fact about the venue's age.
  if (reviewCount === 0) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}
      >
        <Star className={cn(iconSize, "fill-border text-border")} aria-hidden="true" />
        <span className={size === "sm" ? "text-sm" : "text-base"}>
          New venue · no reviews yet
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-foreground", className)}
      aria-label={`Rated ${value.toFixed(1)} out of 5${
        reviewCount !== undefined ? ` from ${reviewCount} reviews` : ""
      }`}
    >
      <Star className={cn(iconSize, "fill-primary text-primary")} aria-hidden="true" />
      <span className={cn("font-medium", size === "sm" ? "text-sm" : "text-base")}>
        {value.toFixed(1)}
      </span>
      {reviewCount !== undefined && (
        <span className="text-muted-foreground text-sm">({reviewCount})</span>
      )}
    </span>
  );
}
