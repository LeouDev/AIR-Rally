import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Venue } from "@/lib/supabase/types";
import type { CreateVenueDraftValues } from "@/lib/validations/venue";

type Client = SupabaseClient<Database>;

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
 * Not called by any page yet — the Explore/Court Details UI still reads
 * from src/lib/mock-data (see ARCHITECTURE.md). Ready for when a venue
 * detail page reads from Supabase instead of the mock Court shape.
 */
export async function getVenueById(supabase: Client, venueId: string): Promise<Venue | null> {
  const { data, error } = await supabase.from("venues").select("*").eq("id", venueId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Same as getVenueById — not wired into Explore yet, but ready to be. */
export async function listActiveVenues(supabase: Client): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("status", "active")
    .order("average_rating", { ascending: false });
  if (error) throw error;
  return data;
}
