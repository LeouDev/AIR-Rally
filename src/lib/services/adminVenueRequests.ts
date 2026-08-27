import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type VenueDemandRow = {
  venueId: string | null;
  venueName: string | null;
  venueStatus: string | null;
  placeName: string | null;
  placeCity: string | null;
  requesters: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  sampleRequestId: string;
  fullyContacted: boolean;
};

export type UnlinkedRequestRow = {
  placeName: string | null;
  placeCity: string | null;
  requesters: number;
  oldest: string;
  requestIds: string[];
};

export type MergeTargetVenue = { id: string; name: string; city: string | null; status: string };

export type VenueRequestCandidate = {
  placeName: string | null;
  placeCity: string | null;
  requesters: number;
  oldest: string;
  requestIds: string[];
  similarity: number;
};

/** count(distinct user_id) on the server side — see the migration's own
 * comment for why: count(*) would double-count anyone whose duplicate
 * request was merged into this cluster. */
export async function listVenueDemand(supabase: Client): Promise<VenueDemandRow[]> {
  const { data, error } = await supabase.rpc("admin_venue_demand");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    venueId: r.venue_id,
    venueName: r.venue_name,
    venueStatus: r.venue_status,
    placeName: r.place_name,
    placeCity: r.place_city,
    requesters: r.requesters,
    firstRequestedAt: r.first_requested_at,
    lastRequestedAt: r.last_requested_at,
    sampleRequestId: r.sample_request_id,
    fullyContacted: r.fully_contacted,
  }));
}

/**
 * Free-text requests never linked to a real venue. Surfaced prominently by
 * design (not buried): these get NO notification when a venue lists, and
 * that failure is invisible from the admin side otherwise — a venue goes
 * live, everyone linked is told, and nothing suggests anyone was missed.
 */
export async function listUnlinkedVenueRequests(supabase: Client): Promise<UnlinkedRequestRow[]> {
  const { data, error } = await supabase.rpc("admin_unlinked_venue_requests");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    placeName: r.place_name,
    placeCity: r.place_city,
    requesters: r.requesters,
    oldest: r.oldest,
    requestIds: r.request_ids,
  }));
}

/**
 * Venues an admin can merge a free-text request into — onboarding venues
 * only (draft/pending_review). An admin already bypasses "Public can view
 * active venues" via is_admin(), so this is a direct query, not a new RPC.
 */
export async function listMergeTargetVenues(supabase: Client): Promise<MergeTargetVenue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id, name, city, status")
    .in("status", ["draft", "pending_review"])
    .order("name");
  if (error) throw error;
  return data;
}

/**
 * Free-text requests that plausibly mean THIS venue, ranked by pg_trgm
 * name similarity — a suggestion, never a link. Surfaced on the venue's
 * own admin page so the ordering constraint (link before 'active', or
 * nothing notifies, ever) is visible at the moment an admin is about to
 * approve it, not on a separate page they'd have to remember to check.
 * Works regardless of the venue's current status: still-onboarding shows
 * "link these before approving"; already-active shows the honest warning
 * that linking now won't notify anyone (see
 * admin_venue_request_candidates()'s own comment — the trigger that
 * would notify only fires on the transition into 'active', not on link).
 */
export async function listVenueRequestCandidates(supabase: Client, venueId: string): Promise<VenueRequestCandidate[]> {
  const { data, error } = await supabase.rpc("admin_venue_request_candidates", { p_venue_id: venueId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    placeName: r.place_name,
    placeCity: r.place_city,
    requesters: r.requesters,
    oldest: r.oldest,
    requestIds: r.request_ids,
    similarity: r.similarity,
  }));
}
