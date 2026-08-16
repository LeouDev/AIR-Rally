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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function parseExploreFilters(searchParams: ExploreSearchParams): MarketplaceFilters {
  const indoorOutdoorRaw = first(searchParams.indoor);
  const sortRaw = first(searchParams.sort);
  const amenitiesRaw = first(searchParams.amenities);
  const dateRaw = first(searchParams.date);
  const timeRaw = first(searchParams.time);

  // The distance filter is all-or-nothing: lat, lng, and radius must all
  // be present and in-range, else none of the three applies.
  const lat = numberOrUndefined(first(searchParams.lat));
  const lng = numberOrUndefined(first(searchParams.lng));
  const radiusKm = numberOrUndefined(first(searchParams.radius));
  const geoValid =
    lat !== undefined && lng !== undefined && radiusKm !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && radiusKm > 0;

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
    surfaceType: first(searchParams.surface)?.trim() || undefined,
    lat: geoValid ? lat : undefined,
    lng: geoValid ? lng : undefined,
    radiusKm: geoValid ? radiusKm : undefined,
    availableOn: dateRaw && DATE_RE.test(dateRaw) ? dateRaw : undefined,
    availableAt: timeRaw && TIME_RE.test(timeRaw) ? timeRaw : undefined,
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
  if (filters.surfaceType) params.set("surface", filters.surfaceType);
  if (filters.lat !== undefined && filters.lng !== undefined && filters.radiusKm !== undefined) {
    params.set("lat", String(filters.lat));
    params.set("lng", String(filters.lng));
    params.set("radius", String(filters.radiusKm));
  }
  if (filters.availableOn) params.set("date", filters.availableOn);
  if (filters.availableAt) params.set("time", filters.availableAt);
  if (filters.sort && filters.sort !== "recommended") params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params;
}
