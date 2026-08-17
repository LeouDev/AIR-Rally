import Link from "next/link";

/**
 * The four decisions people arrive with, one tap each.
 *
 * Real links into Explore rather than client-side state: they are shareable,
 * they work without JS, and Explore does not need to be told about them
 * separately — the URL already is the filter state (see lib/explore-params).
 */
const QUICK_FILTERS = [
  { label: "Under ₱150", href: "/explore?maxPrice=150" },
  { label: "Indoor", href: "/explore?indoor=indoor" },
  { label: "Outdoor", href: "/explore?indoor=outdoor" },
  { label: "Top rated", href: "/explore?minRating=4.5" },
];

export function QuickFilters({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            className="inline-flex min-h-9 items-center rounded-full border-[1.5px] border-border bg-card px-3.5 py-2 text-sm/5 font-medium text-foreground transition-colors hover:border-placeholder focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
