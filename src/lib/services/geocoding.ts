import type { LatLng } from "@/lib/services/maps";

/**
 * OpenStreetMap's free Nominatim search API — no API key, matching the
 * rest of the map stack's zero-new-cost approach (react-leaflet + OSM
 * tiles). A custom User-Agent is required by Nominatim's usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/); requests
 * without one get silently rate-limited harder or blocked.
 */
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "AirRally/1.0 (pickleball court marketplace; contact via app support)";

/**
 * Best-effort only — returns null on any failure (network error, zero
 * results, malformed response) rather than throwing, since a venue's
 * address should never fail to save just because a free third-party
 * geocoder was briefly unavailable. Callers treat a null result as "no
 * map marker for this venue yet," not an error.
 */
export async function geocodeAddress(parts: {
  address: string | null;
  city: string | null;
  stateProvince?: string | null;
  country: string | null;
}): Promise<LatLng | null> {
  const query = [parts.address, parts.city, parts.stateProvince, parts.country].filter(Boolean).join(", ");
  if (!query) return null;

  try {
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;

    const results: unknown = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const first = results[0] as { lat?: unknown; lon?: unknown };
    const lat = typeof first.lat === "string" ? Number.parseFloat(first.lat) : NaN;
    const lng = typeof first.lon === "string" ? Number.parseFloat(first.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
