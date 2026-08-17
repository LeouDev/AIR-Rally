"use client";

import { type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FilterBar } from "@/components/search/FilterBar";
import { SortSelect } from "@/components/search/SortSelect";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import { CLEAR_ALL_FILTERS, describeActiveFilters } from "@/lib/explore-params";
import type { Amenity } from "@/lib/supabase/types";

type ExploreLayoutProps = {
  amenities: Amenity[];
  surfaceTypes: string[];
  resultCount: number;
  results: ReactNode;
  pagination: ReactNode;
};

export function ExploreLayout({ amenities, surfaceTypes, resultCount, results, pagination }: ExploreLayoutProps) {
  const { filters, applyFilters } = useExploreFilters();
  const amenityNames = new Map(amenities.map((amenity) => [amenity.id, amenity.name]));
  const activeChips = describeActiveFilters(filters, amenityNames);
  const countLabel = `${resultCount} court${resultCount === 1 ? "" : "s"}`;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl/[1.625rem] font-semibold text-foreground">{countLabel}</h1>

          <div className="flex items-center gap-2">
            {/* Sort lives in the header from `sm` up and inside the sheet below
                it, so it is reachable at every width — same reason the filter
                trigger below is only hidden once the sidebar has appeared. */}
            <div className="hidden sm:block">
              <SortSelect />
            </div>

            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="relative rounded-lg"
                    aria-label={
                      activeChips.length > 0
                        ? `Filters — ${activeChips.length} active`
                        : "Filters"
                    }
                  >
                    <SlidersHorizontal />
                    {activeChips.length > 0 && (
                      <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem]/4 font-semibold text-primary-foreground">
                        {activeChips.length}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" showCloseButton={false} className="overflow-hidden">
                  <SheetHeader className="flex-row items-center justify-between">
                    <SheetTitle>Filters</SheetTitle>
                    {activeChips.length > 0 && (
                      <Button
                        variant="link"
                        size="sm"
                        className="px-0"
                        onClick={() => applyFilters(CLEAR_ALL_FILTERS)}
                      >
                        Reset
                      </Button>
                    )}
                  </SheetHeader>
                  <div className="flex flex-col gap-5 overflow-y-auto px-5 pb-2">
                    <div className="sm:hidden">
                      <SortSelect />
                    </div>
                    <FilterBar amenities={amenities} surfaceTypes={surfaceTypes} />
                  </div>
                  <SheetFooter>
                    <SheetClose asChild>
                      <Button size="lg" className="w-full">
                        Show {countLabel}
                      </Button>
                    </SheetClose>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>

        {/* Every applied filter, individually removable. A filter you cannot
            see is a filter you cannot undo — which is how "no courts match"
            turns into a dead end. */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => applyFilters(chip.clear)}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-1.5 pr-2.5 pl-3 text-[0.8125rem]/[1.125rem] font-medium text-secondary-foreground transition-colors hover:bg-navy-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
              >
                {chip.label}
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Remove filter</span>
              </button>
            ))}
            <Button variant="link" size="sm" className="px-1" onClick={() => applyFilters(CLEAR_ALL_FILTERS)}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <FilterBar amenities={amenities} surfaceTypes={surfaceTypes} />
          </div>
        </aside>

        <div>
          {results}
          {pagination}
        </div>
      </div>
    </>
  );
}
