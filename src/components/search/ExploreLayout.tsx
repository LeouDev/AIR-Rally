"use client";

import { type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
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
import type { Amenity } from "@/lib/supabase/types";

type ExploreLayoutProps = {
  amenities: Amenity[];
  resultCount: number;
  results: ReactNode;
  pagination: ReactNode;
};

export function ExploreLayout({ amenities, resultCount, results, pagination }: ExploreLayoutProps) {
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

          <div className="lg:hidden">
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
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <FilterBar amenities={amenities} />
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
