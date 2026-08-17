import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Court, VenuePaymongoActivationStatus } from "@/lib/supabase/types";
import type { CreateCourtValues, UpdateCourtValues } from "@/lib/validations/court";

type Client = SupabaseClient<Database>;

/** All courts at a venue, any status — for the owner managing their venue. */
export async function listCourtsByVenue(supabase: Client, venueId: string): Promise<Court[]> {
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .eq("venue_id", venueId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * `venue_id` in the insert is what RLS checks ownership against (the
 * courts insert policy requires the venue to belong to auth.uid() — see
 * supabase/migrations/20260809000003_courts.sql) — there's no separate
 * ownerId parameter to (mis)trust here.
 */
export async function createCourt(supabase: Client, venueId: string, values: CreateCourtValues): Promise<Court> {
  const { data, error } = await supabase
    .from("courts")
    .insert({
      venue_id: venueId,
      name: values.name,
      description: values.description || null,
      surface_type: values.surfaceType || null,
      indoor_outdoor: values.indoorOutdoor,
      capacity: values.capacity ?? null,
      hourly_price: values.hourlyPrice,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCourt(supabase: Client, courtId: string, values: UpdateCourtValues): Promise<Court> {
  const { data, error } = await supabase
    .from("courts")
    .update({
      name: values.name,
      description: values.description || null,
      surface_type: values.surfaceType || null,
      indoor_outdoor: values.indoorOutdoor,
      capacity: values.capacity ?? null,
      hourly_price: values.hourlyPrice,
      status: values.status,
    })
    .eq("id", courtId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * "Deactivate" rather than delete — a court with booking history (later
 * phase) shouldn't disappear, it should stop being publicly listed. Same
 * effect achievable via updateCourt with status: "inactive"; this is a
 * convenience wrapper for the one-click "Deactivate" action in the UI.
 */
export async function setCourtStatus(
  supabase: Client,
  courtId: string,
  status: Court["status"]
): Promise<Court> {
  const { data, error } = await supabase
    .from("courts")
    .update({ status })
    .eq("id", courtId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type CourtCheckoutDisplayInfo = {
  courtName: string;
  venueName: string;
  /**
   * IANA identifier, needed so a booking's time renders in the VENUE's
   * local time. Without it the confirmation page formatted with no
   * timeZone at all, which means the server's zone (UTC): a 5:00 PM
   * Manila booking printed "9:00 AM" on the customer's own receipt while
   * My Bookings, which does pass the zone, correctly said 5:00 PM.
   */
  venueTimezone: string;
  /**
   * Marketplace-split gate, added alongside the PayMongo Platforms
   * checkout extension (see ARCHITECTURE.md): only a venue whose
   * paymongo_activation_status is 'activated' has a real, payable
   * account behind paymongo_account_id — every other status means the
   * checkout falls back to the existing plain (non-split) PayMongo flow.
   */
  venuePaymongoAccountId: string | null;
  venuePaymongoActivationStatus: VenuePaymongoActivationStatus;
};

/**
 * Court + venue display/checkout info — for building a Stripe/PayMongo
 * Checkout line-item description (lib/actions/checkout.ts) and, since the
 * PayMongo Platforms extension, the venue's marketplace-split readiness.
 * Deliberately not the fuller getVenueDetail()/listMyBookingsWithDetails()
 * shapes; this one call site only ever needs these fields, server-derived,
 * never anything a client could supply.
 */
export async function getCourtDisplayInfo(supabase: Client, courtId: string): Promise<CourtCheckoutDisplayInfo | null> {
  const { data: court, error: courtError } = await supabase.from("courts").select("name, venue_id").eq("id", courtId).maybeSingle();
  if (courtError) throw courtError;
  if (!court) return null;

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("name, timezone, paymongo_account_id, paymongo_activation_status")
    .eq("id", court.venue_id)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue) return null;

  return {
    courtName: court.name,
    venueName: venue.name,
    venueTimezone: venue.timezone,
    venuePaymongoAccountId: venue.paymongo_account_id,
    venuePaymongoActivationStatus: venue.paymongo_activation_status,
  };
}
