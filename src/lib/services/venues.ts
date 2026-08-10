import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Venue, VenueMarketplaceRow, VenueDetail, Amenity } from "@/lib/supabase/types";
import type { CreateVenueDraftValues, UpdateVenueValues } from "@/lib/validations/venue";

type Client = SupabaseClient<Database>;

/** Postgres error code for a malformed UUID literal (e.g. a garbage URL param). */
const POSTGRES_INVALID_TEXT_REPRESENTATION = "22P02";

export async function createDraftVenue(
  supabase: Client,
  ownerId: string,
  values: CreateVenueDraftValues
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

export async function updateVenue(supabase: Client, venueId: string, values: UpdateVenueValues): Promise<Venue> {
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
    query = query.ilike("city", sanitizeSearchTerm(filters.city));
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

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  return { venues: data ?? [], total: count ?? 0, page, pageSize };
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
