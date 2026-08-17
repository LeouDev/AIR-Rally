import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Two shapes live here. `size="status"` is the uppercase, tracked lozenge that
// states what a booking *is* (Confirmed / Pending / Cancelled / Completed);
// `size="default"` is the sentence-case pill that adds a fact next to it
// ("Starts in 3 hours", "Open now · closes 8pm").
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent whitespace-nowrap transition-colors focus-visible:ring-4 focus-visible:ring-ring/25 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-pressed",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-navy-raised",
        success: "bg-success-soft text-success-soft-foreground",
        warning: "bg-warning-soft text-warning-soft-foreground",
        destructive:
          "bg-destructive-soft text-destructive-soft-foreground focus-visible:ring-destructive/25",
        neutral: "bg-neutral-soft text-neutral-soft-foreground",
        muted: "bg-muted text-foreground",
        outline:
          "border-[1.5px] border-border text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "px-3 py-1.5 text-[0.8125rem]/[1.125rem] font-medium",
        status:
          "px-3 py-[5px] text-xs/4 font-semibold tracking-[0.06em] uppercase",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
