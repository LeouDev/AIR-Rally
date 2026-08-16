"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Home, Sun, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useExploreFilters } from "@/lib/hooks/useExploreFilters";
import type { Amenity } from "@/lib/supabase/types";

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

  const hasActiveFilters = Boolean(
    filters.indoorOutdoor ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      filters.minRating ||
      (filters.amenityIds && filters.amenityIds.length > 0) ||
      filters.surfaceType ||
      filters.radiusKm !== undefined ||
      filters.availableOn ||
      filters.availableAt
  );

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              applyFilters({
                indoorOutdoor: undefined,
                minPrice: undefined,
                maxPrice: undefined,
                minRating: undefined,
                amenityIds: undefined,
                surfaceType: undefined,
                lat: undefined,
                lng: undefined,
                radiusKm: undefined,
                availableOn: undefined,
                availableAt: undefined,
              })
            }
          >
            Reset
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Court type</Label>
        <div className="flex gap-2">
          {COURT_TYPES.map(({ value, label, icon: Icon }) => {
            const active = value === "any" ? !filters.indoorOutdoor : filters.indoorOutdoor === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => applyFilters({ indoorOutdoor: value === "any" ? undefined : value })}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40"
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
        <Label className="text-xs font-medium text-muted-foreground uppercase">
          Price per hour (₱)
        </Label>
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

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">
          Minimum rating
        </Label>
        <div className="flex gap-2">
          {RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              aria-pressed={(filters.minRating ?? 0) === rating}
              onClick={() => applyFilters({ minRating: rating || undefined })}
              className={cn(
                "flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                (filters.minRating ?? 0) === rating
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
        <Label className="text-xs font-medium text-muted-foreground uppercase">Surface</Label>
        {surfaceTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No surface types to filter by yet.</p>
        ) : (
          <Select
            value={filters.surfaceType ?? ANY_OPTION}
            onValueChange={(value) => applyFilters({ surfaceType: value === ANY_OPTION ? undefined : value })}
          >
            <SelectTrigger className="w-full" aria-label="Surface type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_OPTION}>Any surface</SelectItem>
              {surfaceTypes.map((surface) => (
                <SelectItem key={surface} value={surface}>
                  {surface}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Distance from me</Label>
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

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Open on</Label>
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
        <p className="text-xs text-muted-foreground">
          Shows venues open then — check the court page for live availability.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Amenities</Label>
        {amenities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No amenities to filter by yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {amenities.slice(0, 8).map((amenity) => (
              <button
                key={amenity.id}
                type="button"
                aria-pressed={(filters.amenityIds ?? []).includes(amenity.id)}
                onClick={() => toggleAmenity(amenity.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  (filters.amenityIds ?? []).includes(amenity.id)
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                {amenity.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
