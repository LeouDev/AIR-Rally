import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Pulses, never spins: a spinner says the screen is busy, a pulse says
      // the layout is already correct and only the content is still missing.
      className={cn(
        "animate-skeleton-pulse rounded-md bg-skeleton",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
