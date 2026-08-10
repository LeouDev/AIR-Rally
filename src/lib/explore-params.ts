import type { MarketplaceFilters, VenueSortOption } from "@/lib/services/venues";

export type ExploreSearchParams = Record<string, string | string[] | undefined>;

const SORT_OPTIONS: VenueSortOption[] = ["recommended", "price_asc", "price_desc", "rating"];
const INDOOR_OUTDOOR_OPTIONS = ["indoor", "outdoor", "both"] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The one place URL search params turn into a `MarketplaceFilters`. Used
 * by both the server page (to run the actual query) and `FilterBar` (to
 * initialize its controls from the current URL) so the two can't drift —
 * see the brief's "search/filter/sort should be shareable via URL".
 *
 * `location` is the URL param name (matches the hero SearchBar's
 * existing `?location=` convention and the brief's own example), mapped
 * to `filters.city` internally since that's the DB column it queries.
 */
export function parseExploreFilters(searchParams: ExploreSearchParams): MarketplaceFilters {
  const indoorOutdoorRaw = first(searchParams.indoor);
  const sortRaw = first(searchParams.sort);
  const amenitiesRaw = first(searchParams.amenities);

  return {
    q: first(searchParams.q)?.trim() || undefined,
    city: first(searchParams.location)?.trim() || undefined,
    indoorOutdoor: (INDOOR_OUTDOOR_OPTIONS as readonly string[]).includes(indoorOutdoorRaw ?? "")
      ? (indoorOutdoorRaw as MarketplaceFilters["indoorOutdoor"])
      : undefined,
    minPrice: numberOrUndefined(first(searchParams.minPrice)),
    maxPrice: numberOrUndefined(first(searchParams.maxPrice)),
    minRating: numberOrUndefined(first(searchParams.minRating)),
    amenityIds: amenitiesRaw ? amenitiesRaw.split(",").filter(Boolean) : undefined,
    sort: (SORT_OPTIONS as string[]).includes(sortRaw ?? "") ? (sortRaw as VenueSortOption) : undefined,
    page: numberOrUndefined(first(searchParams.page)),
  };
}

/** Inverse of parseExploreFilters — builds the `?query=string` for a given filter set. */
export function filtersToSearchParams(filters: MarketplaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.city) params.set("location", filters.city);
  if (filters.indoorOutdoor && filters.indoorOutdoor !== "both") params.set("indoor", filters.indoorOutdoor);
  if (filters.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
  if (filters.minRating) params.set("minRating", String(filters.minRating));
  if (filters.amenityIds && filters.amenityIds.length > 0) params.set("amenities", filters.amenityIds.join(","));
  if (filters.sort && filters.sort !== "recommended") params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params;
}
