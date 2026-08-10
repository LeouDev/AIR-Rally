"use client";

import { useState, type ReactNode } from "react";
import { List, MapIcon, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FilterBar } from "@/components/search/FilterBar";
import { SortSelect } from "@/components/search/SortSelect";
import { cn } from "@/lib/utils";
import type { Amenity } from "@/lib/supabase/types";

type ExploreLayoutProps = {
  amenities: Amenity[];
  resultCount: number;
  results: ReactNode;
  map: ReactNode;
  pagination: ReactNode;
};

export function ExploreLayout({ amenities, resultCount, results, map, pagination }: ExploreLayoutProps) {
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {resultCount} court{resultCount === 1 ? "" : "s"}
        </h1>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <SortSelect />
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
                <div className="flex flex-col gap-6 px-4 pb-6">
                  <div className="sm:hidden">
                    <SortSelect />
                  </div>
                  <FilterBar amenities={amenities} />
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
            <FilterBar amenities={amenities} />
          </div>
        </aside>

        <div className={cn(mobileView === "map" && "hidden lg:block")}>
          {results}
          {pagination}
        </div>

        <div
          className={cn(
            "lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-7rem)]",
            mobileView === "list" && "hidden lg:block"
          )}
        >
          {map}
        </div>
      </div>
    </>
  );
}
