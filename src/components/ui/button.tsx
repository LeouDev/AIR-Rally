import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Buttons are pills. Touch targets bottom out at 44px (`default`); `lg` is 52px
// because it is usually the last thing between the player and a paid booking.
// Disabled is a real clay fill, not an opacity knock-down — a ghosted orange
// still reads as "press me", which is the one thing it must not do.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/25 disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125em]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-pressed active:bg-primary-pressed disabled:bg-border disabled:text-placeholder",
        outline:
          "border-[1.5px] border-foreground bg-transparent text-foreground hover:bg-foreground/5 aria-expanded:bg-foreground/5 disabled:border-border disabled:text-placeholder",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-navy-raised aria-expanded:bg-navy-raised disabled:bg-border disabled:text-placeholder",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted disabled:text-placeholder",
        destructive:
          "bg-destructive-soft text-destructive-soft-foreground hover:bg-destructive/15 focus-visible:ring-destructive/25 disabled:bg-border disabled:text-placeholder",
        "destructive-solid":
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/25 disabled:bg-border disabled:text-placeholder",
        link: "text-primary underline-offset-4 hover:underline disabled:text-placeholder",
      },
      size: {
        default: "h-11 gap-2 px-5 text-[0.9375rem]",
        xs: "h-9 gap-1.5 px-3.5 text-sm",
        sm: "h-10 gap-1.5 px-4 text-sm",
        lg: "h-13 gap-2.5 px-6 text-base",
        icon: "size-11",
        "icon-xs": "size-9",
        "icon-sm": "size-10",
        "icon-lg": "size-13",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
