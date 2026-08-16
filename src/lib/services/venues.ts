import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Venue, VenueMarketplaceRow, VenueDetail, VenueStatus, Amenity, Court, VenueOperatingHours, ReviewWithAuthor } from "@/lib/supabase/types";
import type { CreateVenueDraftValues, UpdateVenueValues } from "@/lib/validations/venue";
import type { SetOperatingHoursValues } from "@/lib/validations/venueOperatingHours";
import type { LatLng } from "@/lib/services/maps";
import { getPublicImageUrl } from "@/lib/services/images";
import { listReviewsByVenue } from "@/lib/services/reviews";

type Client = SupabaseClient<Database>;

/** Postgres error code for a malformed UUID literal (e.g. a garbage URL param). */
const POSTGRES_INVALID_TEXT_REPRESENTATION = "22P02";

export async function createDraftVenue(
  supabase: Client,
  ownerId: string,
  values: CreateVenueDraftValues,
  coords?: LatLng | null
): Promise<Venue> {
  const { data, error } = await supabase
    .from("venues")
    .insert({
      owner_id: ownerId,
      name: values.name,
      description: values.description,
      address: values.address,
      city: values.city,
      state_province: values.stateProvince || null,
      country: values.country,
      phone: values.phone,
      email: values.email,
      website: values.website || null,
      indoor_outdoor: values.indoorOutdoor,
      number_of_courts: values.numberOfCourts,
      status: "draft",
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listVenuesByOwner(supabase: Client, ownerId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export type OwnerVenueSummary = Venue & {
  courtCount: number;
  coverImageUrl: string | null;
};

/**
 * The card-dashboard version of listVenuesByOwner(): same venues, plus a
 * real court count (from `courts`, not the static `venues.number_of_courts`
 * field an owner sets once at creation and can go stale) and a cover
 * image (the lowest-`sort_order` venue-level photo, `court_id is null` —
 * see supabase/migrations/20260809000005_court_images.sql). Three flat
 * queries total regardless of how many venues the owner has — court
 * counts and cover images are fetched once each for every venue id, then
 * reduced in JS, rather than one query per venue.
 */
export async function listVenuesByOwnerWithSummary(supabase: Client, ownerId: string): Promise<OwnerVenueSummary[]> {
  const venues = await listVenuesByOwner(supabase, ownerId);
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);

  const [courtsResult, imagesResult] = await Promise.all([
    supabase.from("courts").select("id, venue_id").in("venue_id", venueIds),
    supabase
      .from("court_images")
      .select("venue_id, storage_path, sort_order")
      .in("venue_id", venueIds)
      .is("court_id", null)
      .order("sort_order", { ascending: true }),
  ]);
  if (courtsResult.error) throw courtsResult.error;
  if (imagesResult.error) throw imagesResult.error;

  const courtCountByVenue = new Map<string, number>();
  for (const c of courtsResult.data ?? []) {
    courtCountByVenue.set(c.venue_id, (courtCountByVenue.get(c.venue_id) ?? 0) + 1);
  }

  // Rows are already ordered by sort_order, so the first row seen per
  // venue_id is the cover image — no separate max/min query needed.
  const coverPathByVenue = new Map<string, string>();
  for (const img of imagesResult.data ?? []) {
    if (!coverPathByVenue.has(img.venue_id)) coverPathByVenue.set(img.venue_id, img.storage_path);
  }

  return venues.map((v) => {
    const coverPath = coverPathByVenue.get(v.id);
    return {
      ...v,
      courtCount: courtCountByVenue.get(v.id) ?? 0,
      coverImageUrl: coverPath ? getPublicImageUrl(supabase, coverPath) : null,
    };
  });
}

/**
 * Full row, any status — for the owner's own management pages only. RLS
 * (see supabase/migrations/20260809000002_venues.sql) already ensures
 * this returns null for a venue the caller doesn't own, so there's no
 * separate ownerId check needed here; it's enforced by the database, not
 * by this function remembering to ask.
 */
export async function getVenueForOwner(supabase: Client, venueId: string): Promise<Venue | null> {
  const { data, error } = await supabase.from("venues").select("*").eq("id", venueId).maybeSingle();
  if (error) {
    if (error.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw error;
  }
  return data;
}

/**
 * Hard delete — safe only because the existing RLS policy (see
 * supabase/migrations/20260809000002_venues.sql) already restricts this
 * to `owner_id = auth.uid() AND status = 'draft'` (or admin). A draft
 * venue can't have any bookings yet (booking creation requires an active,
 * listed venue), so the cascade onto `courts`/`court_images`/
 * `court_blocked_periods` (all `on delete cascade`) can never reach a
 * `bookings` row — which does NOT cascade (`courts.id` is referenced by
 * `bookings.court_id` with no `on delete` clause, i.e. restrict), so a
 * delete attempt against a venue with real booking history would fail
 * outright rather than silently destroying it. No app-level ownership or
 * status check here for the same reason every other owner mutation in
 * this file has none: if RLS filters the row out, `.single()` throws and
 * the caller (deleteVenueAction) surfaces a friendly, specific message.
 */
export async function deleteVenue(supabase: Client, venueId: string): Promise<void> {
  const { error } = await supabase.from("venues").delete().eq("id", venueId).select("id").single();
  if (error) throw error;
}

/**
 * The only two owner-initiated status transitions that exist: pausing a
 * venue ('archived', for anything that's no longer operating) and
 * resubmitting one for platform review ('pending_review' — the same
 * unconditional self-service transition every venue already goes
 * through once, now also reachable from 'archived'). Both are enforced
 * by the existing venues_prevent_status_escalation trigger (see
 * supabase/migrations/20260810000020_venue_archive_status.sql) — a
 * non-admin caller can only ever land here for these two target values;
 * anything else (including 'active' itself) is silently reverted by the
 * trigger regardless of what this function sends, so there's no
 * separate app-level check needed.
 */
export async function setVenueStatus(
  supabase: Client,
  venueId: string,
  status: Extract<Venue["status"], "archived" | "pending_review">
): Promise<Venue> {
  const { data, error } = await supabase.from("venues").update({ status }).eq("id", venueId).select("*").single();
  if (error) throw error;
  return data;
}

/**
 * `coords` is only passed when the caller successfully re-geocoded the
 * new address (see updateVenueAction) — omitting it here (rather than
 * writing null) means an address edit that fails to geocode keeps the
 * venue's last-known coordinates instead of silently blanking its map
 * marker.
 */
export async function updateVenue(
  supabase: Client,
  venueId: string,
  values: UpdateVenueValues,
  coords?: LatLng | null
): Promise<Venue> {
  const { data, error } = await supabase
    .from("venues")
    .update({
      name: values.name,
      description: values.description,
      address: values.address,
      city: values.city,
      state_province: values.stateProvince || null,
      country: values.country,
      phone: values.phone,
      email: values.email,
      website: values.website || null,
      indoor_outdoor: values.indoorOutdoor,
      number_of_courts: values.numberOfCourts,
      ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    })
    .eq("id", venueId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// --- Public marketplace reads -------------------------------------------

export type VenueSortOption = "recommended" | "price_asc" | "price_desc" | "rating";

export type MarketplaceFilters = {
  q?: string;
  city?: string;
  indoorOutdoor?: "indoor" | "outdoor" | "both";
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  amenityIds?: string[];
  /** Case-insensitive match against courts.surface_type (free text — see listSurfaceTypes for the live value set). */
  surfaceType?: string;
  /** Distance filter — only applied when lat, lng, AND radiusKm are all present. */
  lat?: number;
  lng?: number;
  radiusKm?: number;
  /**
   * Operating-hours availability approximation (a "YYYY-MM-DD" date and
   * optional "HH:MM" time): keeps venues whose venue_operating_hours
   * cover that day (and time, when given). NOT a live per-court slot
   * check — a venue open at that hour may still be fully booked. Court
   * Details' get_available_slots remains the real booking-time source
   * of truth.
   */
  availableOn?: string;
  availableAt?: string;
  sort?: VenueSortOption;
  page?: number;
  pageSize?: number;
};

export type MarketplaceSearchResult = {
  venues: VenueMarketplaceRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

/**
 * Strips characters that are structurally significant to PostgREST's
 * filter mini-language (used inside `.or()`) before a raw search term is
 * interpolated into one. Without this, a search box is a filter-injection
 * vector — someone could type a string containing `,` or `(`/`)` to
 * append or reshape query conditions PostgREST wasn't meant to receive
 * from user input. This isn't SQL injection (PostgREST parameterizes the
 * actual SQL), but it's the equivalent risk one layer up.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()]/g, "").trim().slice(0, 200);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchMarketplaceVenues(
  supabase: Client,
  filters: MarketplaceFilters = {}
): Promise<MarketplaceSearchResult> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? DEFAULT_PAGE_SIZE)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("venue_marketplace").select("*", { count: "exact" });

  const term = filters.q ? sanitizeSearchTerm(filters.q) : "";
  if (term) {
    // Matches the venue's own name/city/address, OR any of its courts'
    // names — "Court/venue name" per the brief. The court-name half needs
    // a separate lookup first since venue_marketplace has no court name
    // column to filter directly.
    const { data: courtMatches, error: courtError } = await supabase
      .from("courts")
      .select("venue_id")
      .ilike("name", `%${term}%`);
    if (courtError) throw courtError;

    const orParts = [`name.ilike.%${term}%`, `city.ilike.%${term}%`, `address.ilike.%${term}%`];
    const matchingVenueIds = Array.from(new Set((courtMatches ?? []).map((row) => row.venue_id)));
    if (matchingVenueIds.length > 0) {
      orParts.push(`id.in.(${matchingVenueIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  if (filters.city) {
    // Free-text location (city, municipality, or barangay) from the
    // SearchBar's "Where?" field — city is an exact administrative area,
    // but a barangay/street-level term only shows up in the address, so
    // match either rather than requiring an exact city match.
    const locationTerm = sanitizeSearchTerm(filters.city);
    query = query.or(`city.ilike.%${locationTerm}%,address.ilike.%${locationTerm}%`);
  }
  if (filters.indoorOutdoor) {
    query = query.eq("indoor_outdoor", filters.indoorOutdoor);
  }
  if (filters.minPrice !== undefined) {
    query = query.gte("starting_price", filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte("starting_price", filters.maxPrice);
  }
  if (filters.minRating !== undefined) {
    query = query.gte("average_rating", filters.minRating);
  }

  if (filters.surfaceType) {
    const surfaceTerm = sanitizeSearchTerm(filters.surfaceType);
    // Courts' public RLS already scopes this to active courts of active
    // venues, so an inactive court's surface can't match a search.
    const { data: surfaceCourts, error: surfaceError } = await supabase
      .from("courts")
      .select("venue_id")
      .ilike("surface_type", surfaceTerm);
    if (surfaceError) throw surfaceError;
    const surfaceVenueIds = Array.from(new Set((surfaceCourts ?? []).map((row) => row.venue_id)));
    query = query.in("id", surfaceVenueIds);
  }

  if (filters.availableOn) {
    const date = new Date(`${filters.availableOn}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      const dayOfWeek = date.getUTCDay();
      const { data: hoursRows, error: hoursError } = await supabase
        .from("venue_operating_hours")
        .select("venue_id, start_time, end_time")
        .eq("day_of_week", dayOfWeek);
      if (hoursError) throw hoursError;

      let matching = hoursRows ?? [];
      if (filters.availableAt && /^\d{2}:\d{2}$/.test(filters.availableAt)) {
        const [h, m] = filters.availableAt.split(":").map(Number);
        const minutes = h * 60 + m;
        const toMinutes = (hms: string) => {
          const [hh, mm] = hms.split(":").map(Number);
          return hh * 60 + mm;
        };
        matching = matching.filter((row) => toMinutes(row.start_time) <= minutes && minutes < toMinutes(row.end_time));
      }
      const openVenueIds = Array.from(new Set(matching.map((row) => row.venue_id)));
      query = query.in("id", openVenueIds);
    }
  }

  const amenityIds = (filters.amenityIds ?? []).filter((id) => UUID_RE.test(id));
  if (amenityIds.length > 0) {
    const { data: amenityRows, error: amenityError } = await supabase
      .from("venue_amenities")
      .select("venue_id, amenity_id")
      .in("amenity_id", amenityIds);
    if (amenityError) throw amenityError;

    // AND semantics: a venue must have every selected amenity, not just one.
    const countByVenue = new Map<string, number>();
    for (const row of amenityRows ?? []) {
      countByVenue.set(row.venue_id, (countByVenue.get(row.venue_id) ?? 0) + 1);
    }
    const matchingIds = Array.from(countByVenue.entries())
      .filter(([, count]) => count === amenityIds.length)
      .map(([id]) => id);
    query = query.in("id", matchingIds);
  }

  // "Recommended" is a deterministic ranking, not a recommendation engine:
  // highest-rated first, ties broken by review count (a venue with a 4.9
  // from 200 reviews outranks a fresh 5.0 from one review). No personalization.
  switch (filters.sort) {
    case "price_asc":
      query = query.order("starting_price", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      query = query.order("starting_price", { ascending: false, nullsFirst: false });
      break;
    case "rating":
      query = query.order("average_rating", { ascending: false });
      break;
    case "recommended":
    default:
      query = query.order("average_rating", { ascending: false }).order("review_count", { ascending: false });
  }

  const geoActive =
    filters.lat !== undefined && filters.lng !== undefined && filters.radiusKm !== undefined && filters.radiusKm > 0;

  if (!geoActive) {
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    return { venues: data ?? [], total: count ?? 0, page, pageSize };
  }

  // Distance path: fetch every row the DB-side filters allow, then
  // radius-cut and paginate in JS — the same no-PostGIS trade-off
  // listNearbyVenues documents. A DB-side .range() here would paginate
  // BEFORE the radius cut and silently drop in-radius venues from later
  // pages. Venues without coordinates are excluded outright, same as
  // listNearbyVenues. Sorted by distance only under the default
  // "recommended" sort; an explicit price/rating sort keeps its DB order.
  const { data, error } = await query;
  if (error) throw error;

  const withDistance = (data ?? [])
    .filter((v): v is VenueMarketplaceRow & { latitude: number; longitude: number } => v.latitude !== null && v.longitude !== null)
    .map((venue) => ({ venue, distanceKm: haversineDistanceKm(filters.lat!, filters.lng!, venue.latitude, venue.longitude) }))
    .filter((entry) => entry.distanceKm <= filters.radiusKm!);

  if (!filters.sort || filters.sort === "recommended") {
    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  const venues = withDistance.slice(from, from + pageSize).map((entry) => entry.venue);
  return { venues, total: withDistance.length, page, pageSize };
}

/** A user's favorited venues, active-only (the same visibility rule as
 * everywhere else — a favorited venue that's since gone inactive simply
 * won't appear, same as it wouldn't in search). */
export async function listFavoritedVenues(supabase: Client, userId: string): Promise<VenueMarketplaceRow[]> {
  const { data: favoriteRows, error: favoritesError } = await supabase
    .from("favorites")
    .select("venue_id")
    .eq("user_id", userId);
  if (favoritesError) throw favoritesError;

  const venueIds = favoriteRows.map((row) => row.venue_id);
  if (venueIds.length === 0) return [];

  const { data, error } = await supabase.from("venue_marketplace").select("*").in("id", venueIds);
  if (error) throw error;
  return data ?? [];
}

/** Handful of top-rated active venues for the landing page. */
export async function listFeaturedVenues(supabase: Client, limit = 6): Promise<VenueMarketplaceRow[]> {
  const { data, error } = await supabase
    .from("venue_marketplace")
    .select("*")
    .order("average_rating", { ascending: false })
    .order("review_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Great-circle distance in km — used only to rank an already-small
 * marketplace by proximity, not for any billing/legal distance
 * calculation, so a spherical approximation (not a geodesic ellipsoid
 * model) is perfectly adequate here.
 */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Active venues ranked by real distance from the given coordinates.
 * Fetches the whole active marketplace and ranks in JS with the
 * Haversine formula rather than a PostGIS/earthdistance extension this
 * project doesn't have installed — a reasonable trade-off while the
 * marketplace is still small (see ARCHITECTURE.md); revisit with a
 * database-side nearest-neighbor query if the venue count grows large
 * enough for this to matter. A venue with no coordinates yet (its
 * geocoding attempt failed at creation time — see geocodeAddress())
 * is excluded outright, never ranked last with a fake distance.
 */
export async function listNearbyVenues(supabase: Client, lat: number, lng: number, limit = 6): Promise<VenueMarketplaceRow[]> {
  const { data, error } = await supabase.from("venue_marketplace").select("*");
  if (error) throw error;

  return (data ?? [])
    .filter((v): v is VenueMarketplaceRow & { latitude: number; longitude: number } => v.latitude !== null && v.longitude !== null)
    .map((venue) => ({ venue, distanceKm: haversineDistanceKm(lat, lng, venue.latitude, venue.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map((entry) => entry.venue);
}

/**
 * Distinct surface types across active courts, for the search filter —
 * derived from the live data (same precedent as listActiveCities) since
 * courts.surface_type is free text with no CHECK constraint. Dedupes
 * case-insensitively, keeping the first-seen casing.
 */
export async function listSurfaceTypes(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.from("courts").select("surface_type").not("surface_type", "is", null);
  if (error) throw error;
  const byLowercase = new Map<string, string>();
  for (const row of data ?? []) {
    const value = (row.surface_type ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!byLowercase.has(key)) byLowercase.set(key, value);
  }
  return Array.from(byLowercase.values()).sort();
}

/** Distinct cities among active venues, for the search location dropdown. */
export async function listActiveCities(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.from("venue_marketplace").select("city").not("city", "is", null);
  if (error) throw error;
  const cities = new Set((data ?? []).map((row) => row.city).filter((c): c is string => !!c));
  return Array.from(cities).sort();
}

/**
 * Full public detail for one venue: the marketplace row plus its active
 * courts, amenities, and images. Returns null for a venue that doesn't
 * exist, isn't active, OR whose id isn't even a validly-formed UUID (a
 * malformed URL param, e.g. `/courts/not-a-uuid`) — all three should look
 * exactly like "not found" to a player, never a raw database error, and a
 * draft venue in particular shouldn't confirm it exists under a different
 * status.
 */
export async function getVenueDetail(supabase: Client, venueId: string): Promise<VenueDetail | null> {
  const { data: venue, error: venueError } = await supabase
    .from("venue_marketplace")
    .select("*")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError) {
    if (venueError.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw venueError;
  }
  if (!venue) return null;

  const [courtsResult, amenityLinksResult, imagesResult] = await Promise.all([
    supabase.from("courts").select("*").eq("venue_id", venueId).eq("status", "active").order("name"),
    supabase.from("venue_amenities").select("amenity_id").eq("venue_id", venueId),
    supabase.from("court_images").select("*").eq("venue_id", venueId).order("sort_order"),
  ]);
  if (courtsResult.error) throw courtsResult.error;
  if (amenityLinksResult.error) throw amenityLinksResult.error;
  if (imagesResult.error) throw imagesResult.error;

  let amenities: Amenity[] = [];
  const amenityIds = (amenityLinksResult.data ?? []).map((row) => row.amenity_id);
  if (amenityIds.length > 0) {
    const { data, error } = await supabase.from("amenities").select("*").in("id", amenityIds);
    if (error) throw error;
    amenities = data ?? [];
  }

  return {
    ...venue,
    courts: courtsResult.data ?? [],
    amenities,
    images: imagesResult.data ?? [],
  };
}

// --- Operating hours (owner-managed; RLS already supported this table,
// only the application layer was missing — see venueReadiness.ts) ------

export async function listOperatingHours(supabase: Client, venueId: string): Promise<VenueOperatingHours[]> {
  const { data, error } = await supabase
    .from("venue_operating_hours")
    .select("*")
    .eq("venue_id", venueId)
    .order("day_of_week");
  if (error) throw error;
  return data;
}

/** Replace-all write, mirroring setVenueAmenities()'s exact delete-then-insert shape. */
export async function setOperatingHours(supabase: Client, venueId: string, values: SetOperatingHoursValues): Promise<void> {
  const { error: deleteError } = await supabase.from("venue_operating_hours").delete().eq("venue_id", venueId);
  if (deleteError) throw deleteError;

  if (values.windows.length === 0) return;

  const { error: insertError } = await supabase.from("venue_operating_hours").insert(
    values.windows.map((w) => ({
      venue_id: venueId,
      day_of_week: w.dayOfWeek,
      start_time: `${w.startTime}:00`,
      end_time: `${w.endTime}:00`,
    }))
  );
  if (insertError) throw insertError;
}

// --- PayMongo Platforms marketplace onboarding (see ARCHITECTURE.md) ---

/**
 * Thin wrapper around sync_venue_paymongo_status() — the only owner-facing
 * write path for linking a venue to a freshly-created PayMongo Platforms
 * account. Called once, right after createPayMongoMerchantAccount()
 * succeeds; the RPC itself enforces owner_id = auth.uid() and refuses to
 * relink an already-linked venue, so there's no separate check needed
 * here.
 */
export async function linkVenuePaymongoAccount(supabase: Client, venueId: string, paymongoAccountId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("sync_venue_paymongo_status", {
    p_venue_id: venueId,
    p_paymongo_account_id: paymongoAccountId,
    p_activation_status: "pending",
  });
  if (error) throw error;
  return data ?? false;
}

/**
 * Thin wrapper around sync_venue_paymongo_activation() — webhook-only, per
 * the RPC's own design (looked up purely by paymongo_account_id, no venue
 * row need ever be read first). Called from the PayMongo webhook route
 * when a merchant.activated/merchant.declined event arrives. A `false`
 * return means no venue has that account id linked (a stray/unmatched
 * event) — a safe no-op, not an error.
 */
export async function syncVenuePaymongoActivation(
  supabase: Client,
  params: { paymongoAccountId: string; activationStatus: "under_review" | "activated" | "declined"; declinedReason?: string | null }
): Promise<boolean> {
  const { data, error } = await supabase.rpc("sync_venue_paymongo_activation", {
    p_paymongo_account_id: params.paymongoAccountId,
    p_activation_status: params.activationStatus,
    p_declined_reason: params.declinedReason ?? null,
  });
  if (error) throw error;
  return data ?? false;
}

// --- Admin operations (Phase 5.4) ---------------------------------------

/**
 * Sibling to setVenueStatus() above, not a widened version of it — that
 * function's type restriction ("archived" | "pending_review") stays
 * exactly as-is for the owner self-service path. Setting active/suspended
 * is an admin-only decision; venues_prevent_status_escalation (see
 * supabase/migrations/20260809000002_venues.sql, function redefined in
 * 20260810000020_venue_archive_status.sql) already permits any status
 * change once is_admin() is true, so this function is purely the missing
 * app-layer entry point, not a new database guarantee.
 */
export async function setVenueStatusAsAdmin(
  supabase: Client,
  venueId: string,
  status: Extract<VenueStatus, "active" | "suspended">
): Promise<Venue> {
  const { data, error } = await supabase.from("venues").update({ status }).eq("id", venueId).select("*").single();
  if (error) throw error;
  return data;
}

export type AdminVenueSummary = Venue & { ownerDisplayName: string | null; courtCount: number };

/**
 * Every venue regardless of status, for the admin pending/active/
 * suspended tabs — `venues` RLS already lets is_admin() select any row,
 * so this is a plain read, not a privileged bypass. Owner display names
 * and court counts are fetched in two batched queries (never one query
 * per venue), same pattern as listVenuesByOwnerWithSummary() above.
 */
export async function listVenuesForAdmin(supabase: Client, status?: VenueStatus): Promise<AdminVenueSummary[]> {
  let query = supabase.from("venues").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data: venues, error } = await query;
  if (error) throw error;
  if (!venues || venues.length === 0) return [];

  const ownerIds = Array.from(new Set(venues.map((v) => v.owner_id)));
  const venueIds = venues.map((v) => v.id);

  const [ownersResult, courtsResult] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", ownerIds),
    supabase.from("courts").select("id, venue_id").in("venue_id", venueIds),
  ]);
  if (ownersResult.error) throw ownersResult.error;
  if (courtsResult.error) throw courtsResult.error;

  const ownerNameById = new Map((ownersResult.data ?? []).map((o) => [o.id, o.display_name]));
  const courtCountByVenue = new Map<string, number>();
  for (const c of courtsResult.data ?? []) {
    courtCountByVenue.set(c.venue_id, (courtCountByVenue.get(c.venue_id) ?? 0) + 1);
  }

  return venues.map((v) => ({
    ...v,
    ownerDisplayName: ownerNameById.get(v.owner_id) ?? null,
    courtCount: courtCountByVenue.get(v.id) ?? 0,
  }));
}

export type AdminVenueDetail = Venue & {
  ownerDisplayName: string | null;
  courts: Court[];
  recentReviews: ReviewWithAuthor[];
};

/**
 * Same shape as getVenueDetail() but reads `venues` directly instead of
 * the venue_marketplace view — deliberately, since the view is
 * active-only and excludes owner_id/status by construction (see
 * supabase/migrations/20260809000008_marketplace_view.sql), and an admin
 * needs to see a pending/suspended/draft venue's real status and owner,
 * not just what a player would see. All courts (any status), not just
 * active ones, for the same reason.
 */
export async function getVenueForAdmin(supabase: Client, venueId: string): Promise<AdminVenueDetail | null> {
  const { data: venue, error } = await supabase.from("venues").select("*").eq("id", venueId).maybeSingle();
  if (error) {
    if (error.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw error;
  }
  if (!venue) return null;

  const [ownerResult, courtsResult, recentReviews] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", venue.owner_id).maybeSingle(),
    supabase.from("courts").select("*").eq("venue_id", venueId).order("name"),
    listReviewsByVenue(supabase, venueId, 10),
  ]);
  if (ownerResult.error) throw ownerResult.error;
  if (courtsResult.error) throw courtsResult.error;

  return {
    ...venue,
    ownerDisplayName: ownerResult.data?.display_name ?? null,
    courts: courtsResult.data ?? [],
    recentReviews,
  };
}
