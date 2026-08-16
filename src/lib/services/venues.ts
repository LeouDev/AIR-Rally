import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Venue, VenueMarketplaceRow, VenueDetail, Amenity, VenueOperatingHours } from "@/lib/supabase/types";
import type { CreateVenueDraftValues, UpdateVenueValues } from "@/lib/validations/venue";
import type { SetOperatingHoursValues } from "@/lib/validations/venueOperatingHours";
import { getPublicImageUrl } from "@/lib/services/images";

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
