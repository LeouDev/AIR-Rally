"use client";

import { cn } from "@/lib/utils";

/**
 * The one selectable chip in the app — filters, amenities, surfaces, the
 * quick-filter row on Home.
 *
 * Selected is navy, not orange. Orange is reserved for the thing you should
 * touch next, and a screen with six chosen filters would otherwise have six
 * things all shouting that they are the next action.
 *
 * Selection is carried by `aria-pressed`, so it survives for a screen reader
 * and in forced-colors mode where the fill swap alone would be invisible.
 */
export function SelectionChip({
  selected,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected || undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm/5 font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25",
        selected
          ? "bg-secondary text-secondary-foreground"
          : "border-[1.5px] border-border bg-card text-foreground hover:border-placeholder",
        className
      )}
      {...props}
    />
  );
}
