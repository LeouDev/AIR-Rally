"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Home, Sun, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SelectionChip } from "@/components/shared/SelectionChip";
import { cn } from "@/lib/utils";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import { CLEAR_ALL_FILTERS, describeActiveFilters } from "@/lib/explore-params";
import type { Amenity } from "@/lib/supabase/types";

/** Uppercase, tracked section label — the one heading style inside the sheet. */
const SECTION_LABEL = "text-xs/4 font-semibold tracking-[0.12em] text-muted-foreground uppercase";

const COURT_TYPES: { value: "any" | "indoor" | "outdoor"; label: string; icon: typeof Home }[] = [
  { value: "any", label: "Any", icon: Layers },
  { value: "indoor", label: "Indoor", icon: Home },
  { value: "outdoor", label: "Outdoor", icon: Sun },
];

const RATINGS = [0, 4, 4.5];
const RADII_KM = [5, 10, 25, 50];
const PRICE_DEBOUNCE_MS = 500;
const ANY_OPTION = "any";

type FilterBarProps = {
  amenities: Amenity[];
  surfaceTypes: string[];
  className?: string;
};

export function FilterBar({ amenities, surfaceTypes, className }: FilterBarProps) {
  const { searchParams } = useExploreFilters();
  // Remounting on URL change (Reset, browser back/forward) resets the
  // local price-input state to match the new filters — same effect as the
  // sync-effect this replaces, without a synchronous setState-in-effect.
  // Only re-keys when the URL itself changes, not on every `filters`
  // recompute, so it doesn't fight the debounce below.
  return <FilterBarFields key={searchParams.toString()} amenities={amenities} surfaceTypes={surfaceTypes} className={className} />;
}

function FilterBarFields({ amenities, surfaceTypes, className }: FilterBarProps) {
  const { filters, applyFilters } = useExploreFilters();
  const amenityNames = new Map(amenities.map((amenity) => [amenity.id, amenity.name]));

  const [minPriceInput, setMinPriceInput] = useState(filters.minPrice?.toString() ?? "");
  const [maxPriceInput, setMaxPriceInput] = useState(filters.maxPrice?.toString() ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      const min = minPriceInput ? Number(minPriceInput) : undefined;
      const max = maxPriceInput ? Number(maxPriceInput) : undefined;
      if (min !== filters.minPrice || max !== filters.maxPrice) {
        applyFilters({ minPrice: min, maxPrice: max });
      }
    }, PRICE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minPriceInput, maxPriceInput]);

  function toggleAmenity(id: string) {
    const set = new Set(filters.amenityIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    applyFilters({ amenityIds: Array.from(set) });
  }

  function applyRadius(value: string) {
    if (value === ANY_OPTION) {
      applyFilters({ lat: undefined, lng: undefined, radiusKm: undefined });
      return;
    }
    const radiusKm = Number(value);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Your browser doesn't support location access.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyFilters({ lat: position.coords.latitude, lng: position.coords.longitude, radiusKm });
      },
      () => {
        toast.error("We couldn't get your location. Allow location access to filter by distance.");
      }
    );
  }

  const activeChips = describeActiveFilters(filters, amenityNames);
  const priceSummary =
    filters.minPrice === undefined && filters.maxPrice === undefined
      ? "Any"
      : `₱${filters.minPrice ?? 0} – ${filters.maxPrice !== undefined ? `₱${filters.maxPrice}` : "any"}`;

  return (
    <div className={cn("@container flex flex-col gap-5", className)}>
      <div className="flex items-center justify-between lg:hidden">
        <h2 className={SECTION_LABEL}>Filters</h2>
        {activeChips.length > 0 && (
          <Button variant="link" size="sm" className="px-0" onClick={() => applyFilters(CLEAR_ALL_FILTERS)}>
            Reset
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Label className={SECTION_LABEL}>Court type</Label>
        <div className="flex flex-col gap-2 @xs:flex-row">
          {COURT_TYPES.map(({ value, label, icon: Icon }) => {
            const active = value === "any" ? !filters.indoorOutdoor : filters.indoorOutdoor === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => applyFilters({ indoorOutdoor: value === "any" ? undefined : value })}
                className={cn(
                  "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-[0.9375rem]/5 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25",
                  active
                    ? "bg-secondary font-semibold text-secondary-foreground"
                    : "border-[1.5px] border-border bg-card font-medium text-foreground hover:border-placeholder"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label className={SECTION_LABEL}>Price per hour</Label>
          <span className="font-mono text-sm/5 text-foreground">{priceSummary}</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Min"
            aria-label="Minimum price per hour"
            value={minPriceInput}
            onChange={(e) => setMinPriceInput(e.target.value)}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Max"
            aria-label="Maximum price per hour"
            value={maxPriceInput}
            onChange={(e) => setMaxPriceInput(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-4 @xs:flex-row">
        <div className="flex flex-1 flex-col gap-2.5">
          <Label className={SECTION_LABEL}>Min rating</Label>
          <div className="flex gap-2">
            {RATINGS.map((rating) => (
              <SelectionChip
                key={rating}
                selected={(filters.minRating ?? 0) === rating}
                onClick={() => applyFilters({ minRating: rating || undefined })}
                className="flex-1 justify-center"
              >
                {rating === 0 ? "Any" : `★ ${rating}+`}
              </SelectionChip>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5">
          <Label className={SECTION_LABEL}>Distance</Label>
          <Select value={filters.radiusKm !== undefined ? String(filters.radiusKm) : ANY_OPTION} onValueChange={applyRadius}>
            <SelectTrigger className="w-full" aria-label="Distance from your location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_OPTION}>Any distance</SelectItem>
              {RADII_KM.map((km) => (
                <SelectItem key={km} value={String(km)}>
                  Within {km} km
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className={SECTION_LABEL}>Surface</Label>
        {surfaceTypes.length === 0 ? (
          <p className="text-sm text-subtle">No surface types to filter by yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {surfaceTypes.map((surface) => {
              const selected = filters.surfaceType === surface;
              return (
                <SelectionChip
                  key={surface}
                  selected={selected}
                  onClick={() => applyFilters({ surfaceType: selected ? undefined : surface })}
                >
                  {surface}
                </SelectionChip>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className={SECTION_LABEL}>Open on</Label>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Open on date"
            value={filters.availableOn ?? ""}
            onChange={(e) => applyFilters({ availableOn: e.target.value || undefined, availableAt: e.target.value ? filters.availableAt : undefined })}
          />
          <Input
            type="time"
            aria-label="Open at time"
            disabled={!filters.availableOn}
            value={filters.availableAt ?? ""}
            onChange={(e) => applyFilters({ availableAt: e.target.value || undefined })}
          />
        </div>
        <p className="text-xs/4 text-muted-foreground">
          Shows venues open then — check the court page for live availability.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className={SECTION_LABEL}>Amenities</Label>
        {amenities.length === 0 ? (
          <p className="text-sm text-subtle">No amenities to filter by yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {amenities.map((amenity) => (
              <SelectionChip
                key={amenity.id}
                selected={(filters.amenityIds ?? []).includes(amenity.id)}
                onClick={() => toggleAmenity(amenity.id)}
              >
                {amenity.name}
              </SelectionChip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
