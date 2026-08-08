"use client";

import { Home, Sun, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { mockAmenities } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { CourtType } from "@/types/court";

export type ExploreFilters = {
  courtType: CourtType | "any";
  minPrice: string;
  maxPrice: string;
  minRating: number;
  amenityIds: string[];
};

export const defaultExploreFilters: ExploreFilters = {
  courtType: "any",
  minPrice: "",
  maxPrice: "",
  minRating: 0,
  amenityIds: [],
};

type FilterBarProps = {
  filters: ExploreFilters;
  onChange: (filters: ExploreFilters) => void;
  className?: string;
};

const COURT_TYPES: { value: ExploreFilters["courtType"]; label: string; icon: typeof Home }[] = [
  { value: "any", label: "Any", icon: Layers },
  { value: "indoor", label: "Indoor", icon: Home },
  { value: "outdoor", label: "Outdoor", icon: Sun },
];

const RATINGS = [0, 4, 4.5];

export function FilterBar({ filters, onChange, className }: FilterBarProps) {
  function update(partial: Partial<ExploreFilters>) {
    onChange({ ...filters, ...partial });
  }

  function toggleAmenity(id: string) {
    const set = new Set(filters.amenityIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ amenityIds: Array.from(set) });
  }

  const hasActiveFilters =
    filters.courtType !== "any" ||
    filters.minPrice !== "" ||
    filters.maxPrice !== "" ||
    filters.minRating !== 0 ||
    filters.amenityIds.length > 0;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => onChange(defaultExploreFilters)}>
            Reset
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Court type</Label>
        <div className="flex gap-2">
          {COURT_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.courtType === value}
              onClick={() => update({ courtType: value })}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filters.courtType === value
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">
          Price per hour (₱)
        </Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Min"
            aria-label="Minimum price per hour"
            value={filters.minPrice}
            onChange={(e) => update({ minPrice: e.target.value })}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Max"
            aria-label="Maximum price per hour"
            value={filters.maxPrice}
            onChange={(e) => update({ maxPrice: e.target.value })}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">
          Minimum rating
        </Label>
        <div className="flex gap-2">
          {RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              aria-pressed={filters.minRating === rating}
              onClick={() => update({ minRating: rating })}
              className={cn(
                "flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filters.minRating === rating
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {rating === 0 ? "Any" : `${rating}+`}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Amenities</Label>
        <div className="flex flex-wrap gap-2">
          {mockAmenities.slice(0, 8).map((amenity) => (
            <button
              key={amenity.id}
              type="button"
              aria-pressed={filters.amenityIds.includes(amenity.id)}
              onClick={() => toggleAmenity(amenity.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filters.amenityIds.includes(amenity.id)
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {amenity.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
