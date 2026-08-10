import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ExplorePaginationProps = {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
};

/** Plain links, not client-side pagination state — a page URL always
 * resolves the same result set even after a reload, matching the
 * shareable-search-URL requirement for the rest of Explore's state. */
export function ExplorePagination({ page, totalPages, buildHref }: ExplorePaginationProps) {
  if (totalPages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
      <Link
        href={buildHref(Math.max(1, page - 1))}
        aria-disabled={!hasPrevious}
        tabIndex={hasPrevious ? undefined : -1}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          !hasPrevious && "pointer-events-none opacity-40"
        )}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Previous
      </Link>
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <Link
        href={buildHref(Math.min(totalPages, page + 1))}
        aria-disabled={!hasNext}
        tabIndex={hasNext ? undefined : -1}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          !hasNext && "pointer-events-none opacity-40"
        )}
      >
        Next
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </nav>
  );
}
