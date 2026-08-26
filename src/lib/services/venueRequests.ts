import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CreateVenueRequestValues } from "@/lib/validations/venueRequest";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export class DuplicateVenueRequestError extends Error {
  constructor() {
    super("You've already asked for this venue.");
    this.name = "DuplicateVenueRequestError";
  }
}

export type VenueRequestSuggestion = { placeName: string; placeCity: string };

export type PublicVenueRequestSummary = {
  displayName: string;
  city: string;
  requesters: number;
  showCount: boolean;
};

export type MyVenueRequestDemand = { requesters: number; showCount: boolean };

/**
 * Free-text-only suggestions (migration 20260810000106) — deliberately never
 * surfaces a draft/pending_review venue's name; see the migration for why.
 * Empty query returns nothing rather than an unfiltered top-8, since an
 * empty-input suggestion list isn't a suggestion.
 */
export async function getVenueRequestSuggestions(
  supabase: Client,
  query: string
): Promise<VenueRequestSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.rpc("venue_request_place_suggestions", {
    p_query: trimmed,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({ placeName: row.place_name, placeCity: row.place_city }));
}

/**
 * Records a player's request. userId comes from the caller's own session,
 * never a parameter — the RLS insert policy enforces the same thing
 * (`user_id = auth.uid()`), but failing at the same point in application
 * code rather than only at the database is cheaper to read.
 *
 * The unique partial index (one request per user per place) is what makes
 * "14 players asked" a real count; a second identical submission from the
 * same user is a friendly no-op message here, not a raw constraint error.
 */
export async function createVenueRequest(
  supabase: Client,
  userId: string,
  values: CreateVenueRequestValues
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("venue_requests")
    .insert({
      user_id: userId,
      place_name: values.placeName,
      place_city: values.placeCity ?? null,
      note: values.note ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateVenueRequestError();
    throw error;
  }
  return { id: data.id };
}

/**
 * The requester's own feedback after submitting — "you're the Nth to ask",
 * or the promise below the threshold of 5. Refuses for a request the caller
 * does not own (see venue_request_demand_for_me's own SECURITY DEFINER
 * check), which is correct: this is feedback to the submitter, not the
 * public artifact.
 */
export async function getMyVenueRequestDemand(
  supabase: Client,
  requestId: string
): Promise<MyVenueRequestDemand> {
  const { data, error } = await supabase
    .rpc("venue_request_demand_for_me", { p_request_id: requestId })
    .single();
  if (error) throw error;
  return { requesters: data.requesters, showCount: data.show_count };
}

/**
 * The genuinely public summary (migration 20260810000106) — callable with no
 * session at all. This is the one function in this file safe to call from a
 * page that requires no sign-in.
 */
export async function getPublicVenueRequestSummary(
  supabase: Client,
  requestId: string
): Promise<PublicVenueRequestSummary | null> {
  const { data, error } = await supabase
    .rpc("public_venue_request_summary", { p_request_id: requestId })
    .single();
  if (error) {
    // no_data_found (P0002/no such row) is a 404, not a thrown error — every
    // other error is real and should surface.
    if (error.code === "PGRST116" || /no such request/i.test(error.message)) return null;
    throw error;
  }
  return {
    displayName: data.display_name,
    city: data.city,
    requesters: data.requesters,
    showCount: data.show_count,
  };
}
