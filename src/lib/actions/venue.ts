"use server";

import { revalidatePath } from "next/cache";
import { createDraftVenue, updateVenue, deleteVenue, setOperatingHours } from "@/lib/services/venues";
import { setVenueAmenities } from "@/lib/services/amenities";
import {
  createVenueDraftSchema,
  updateVenueSchema,
  setVenueAmenitiesSchema,
  deleteVenueSchema,
  type CreateVenueDraftValues,
  type UpdateVenueValues,
  type SetVenueAmenitiesValues,
} from "@/lib/validations/venue";
import { setOperatingHoursSchema, type SetOperatingHoursValues } from "@/lib/validations/venueOperatingHours";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Venue } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function createVenueDraftAction(values: CreateVenueDraftValues): Promise<ActionResult<Venue>> {
  const parsed = createVenueDraftSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Sign in to list your court." };
  }

  try {
    // Grants 'venue_owner' the first time a 'player' reaches this step —
    // a safe no-op for an account that's already venue_owner/admin (see
    // request_venue_owner_role() and the role/permission audit). This is
    // what venues' own INSERT policy now actually checks; without this
    // call, createDraftVenue() below would fail RLS for a still-'player'
    // account.
    const { error: roleError } = await supabase.rpc("request_venue_owner_role");
    if (roleError) throw roleError;

    const venue = await createDraftVenue(supabase, user.id, parsed.data);
    revalidatePath("/list-your-court");
    return { success: true, data: venue };
  } catch (error) {
    logServerError("venue.createDraft", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save your venue.") };
  }
}

/**
 * No ownerId/venueId ownership check happens in this function — that's
 * deliberate. `updateVenue` targets the row by id only; RLS (the
 * `owner_id = auth.uid()` policy on `venues`, see
 * supabase/migrations/20260809000002_venues.sql) is what actually
 * prevents an update to a venue this session doesn't own. If it isn't
 * theirs, the update matches zero rows and this surfaces as a normal
 * "couldn't save" error, not a special case to code around here.
 */
export async function updateVenueAction(venueId: string, values: UpdateVenueValues): Promise<ActionResult<Venue>> {
  const parsed = updateVenueSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const venue = await updateVenue(supabase, venueId, parsed.data);
    revalidatePath(`/list-your-court/${venueId}`);
    revalidatePath("/list-your-court");
    return { success: true, data: venue };
  } catch (error) {
    logServerError("venue.update", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save your venue.") };
  }
}

/**
 * Only succeeds for the caller's own draft venues — the existing
 * `venues` DELETE RLS policy (owner_id = auth.uid() AND status =
 * 'draft', or admin — see supabase/migrations/20260809000002_venues.sql)
 * is the entire enforcement here, same posture as every other owner
 * mutation in this file. A non-draft or not-owned venue simply matches
 * zero rows, which `deleteVenue()`'s `.single()` turns into a thrown
 * error, surfaced below as a specific, honest message rather than a
 * generic one.
 */
export async function deleteVenueAction(venueId: string): Promise<ActionResult> {
  const parsed = deleteVenueSchema.safeParse(venueId);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    await deleteVenue(supabase, parsed.data);
    revalidatePath("/list-your-court");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("venue.delete", error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, "Only draft venues can be deleted — active venues can't be removed this way."),
    };
  }
}

export async function setVenueAmenitiesAction(
  venueId: string,
  values: SetVenueAmenitiesValues
): Promise<ActionResult> {
  const parsed = setVenueAmenitiesSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    await setVenueAmenities(supabase, venueId, parsed.data.amenityIds);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("venue.setAmenities", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update amenities.") };
  }
}

/**
 * No ownership check here either, for the exact same reason as
 * updateVenueAction above: RLS on venue_operating_hours (see
 * supabase/migrations/20260810000002_venue_operating_hours.sql) already
 * requires venues.owner_id = auth.uid() for insert/update/delete, so a
 * non-owner's call simply fails at the database rather than needing a
 * redundant check here.
 */
export async function setOperatingHoursAction(venueId: string, values: SetOperatingHoursValues): Promise<ActionResult> {
  const parsed = setOperatingHoursSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    await setOperatingHours(supabase, venueId, parsed.data);
    revalidatePath(`/list-your-court/${venueId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("venue.setOperatingHours", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update operating hours.") };
  }
}
