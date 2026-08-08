"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { List, MapIcon, SlidersHorizontal, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterBar, defaultExploreFilters, type ExploreFilters } from "@/components/search/FilterBar";
import { MapPlaceholder } from "@/components/search/MapPlaceholder";
import { CourtCard } from "@/components/court/CourtCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { mockCourts } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

function ExploreContent() {
  const searchParams = useSearchParams();
  const location = searchParams.get("location");

  const [filters, setFilters] = useState<ExploreFilters>(defaultExploreFilters);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  const results = useMemo(() => {
    return mockCourts.filter((court) => {
      if (
        filters.courtType !== "any" &&
        court.courtType !== "both" &&
        court.courtType !== filters.courtType
      ) {
        return false;
      }
      const min = filters.minPrice ? Number(filters.minPrice) : undefined;
      const max = filters.maxPrice ? Number(filters.maxPrice) : undefined;
      if (min !== undefined && court.pricePerHour < min) return false;
      if (max !== undefined && court.pricePerHour > max) return false;
      if (filters.minRating && court.rating < filters.minRating) return false;
      if (
        filters.amenityIds.length > 0 &&
        !filters.amenityIds.every((id) => court.amenityIds.includes(id))
      ) {
        return false;
      }
      return true;
    });
  }, [filters]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4">
        <SearchBar variant="compact" />

        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {results.length} court{results.length === 1 ? "" : "s"}
              {location ? ` near ${location}` : ""}
            </h1>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <SlidersHorizontal className="size-3.5" />
                  Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">
                  <FilterBar filters={filters} onChange={setFilters} />
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setMobileView((v) => (v === "list" ? "map" : "list"))}
            >
              {mobileView === "list" ? (
                <>
                  <MapIcon className="size-3.5" /> Map
                </>
              ) : (
                <>
                  <List className="size-3.5" /> List
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr_360px]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <FilterBar filters={filters} onChange={setFilters} />
          </div>
        </aside>

        <div className={cn(mobileView === "map" && "hidden lg:block")}>
          {results.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((court) => (
                <CourtCard key={court.id} court={court} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={SearchX}
              title="No courts match your filters"
              description="Try widening your price range or clearing a filter to see more results."
              action={
                <Button variant="outline" onClick={() => setFilters(defaultExploreFilters)}>
                  Reset filters
                </Button>
              }
            />
          )}
        </div>

        <div className={cn("lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-7rem)]", mobileView === "list" && "hidden lg:block")}>
          <MapPlaceholder className="h-64 lg:h-full" resultCount={results.length} />
        </div>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreContent />
    </Suspense>
  );
}
