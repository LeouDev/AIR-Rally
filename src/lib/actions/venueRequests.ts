"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/services/admin";
import {
  createVenueRequest,
  getVenueRequestSuggestions,
  getMyVenueRequestDemand,
  getPublicVenueRequestSummary,
  DuplicateVenueRequestError,
  type VenueRequestSuggestion,
  type MyVenueRequestDemand,
  type PublicVenueRequestSummary,
} from "@/lib/services/venueRequests";
import { createVenueRequestSchema, type CreateVenueRequestValues } from "@/lib/validations/venueRequest";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function createVenueRequestAction(
  values: CreateVenueRequestValues
): Promise<ActionResult<{ id: string }>> {
  const parsed = createVenueRequestSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Please fix the errors below." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to ask for a venue." };
  }

  try {
    const result = await createVenueRequest(supabase, user.id, parsed.data);
    revalidatePath("/explore");
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof DuplicateVenueRequestError) {
      return { success: false, error: error.message };
    }
    logServerError("venueRequests.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't send that request.") };
  }
}

/**
 * Suggestions require sign-in — venue_request_place_suggestions() is granted
 * to `authenticated` only (see migration 20260810000106: the dedup value is
 * real when it steers a signed-in requester onto an existing entry; an
 * anonymous visitor typing into a search box before deciding to sign up gets
 * an empty list rather than a 401, which reads as "no matches" rather than
 * an error.
 */
export async function getVenueRequestSuggestionsAction(
  query: string
): Promise<ActionResult<VenueRequestSuggestion[]>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: true, data: [] };

  try {
    const suggestions = await getVenueRequestSuggestions(supabase, query);
    return { success: true, data: suggestions };
  } catch (error) {
    logServerError("venueRequests.suggestions", error);
    return { success: true, data: [] }; // autocomplete degrading to empty beats surfacing an error toast
  }
}

const requestIdSchema = z.uuid();

export async function getMyVenueRequestDemandAction(
  requestId: string
): Promise<ActionResult<MyVenueRequestDemand>> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return { success: false, error: "Invalid request." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    const demand = await getMyVenueRequestDemand(supabase, parsed.data);
    return { success: true, data: demand };
  } catch (error) {
    logServerError("venueRequests.myDemand", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}

/**
 * The one call in this file that needs no session at all — the public page
 * calls this directly rather than through an action requiring auth, since
 * the whole point is a venue manager with no account can load it. Kept as a
 * server action anyway (not a direct service call from the page) so error
 * handling stays in one place and the page component stays thin.
 */
export async function getPublicVenueRequestSummaryAction(
  requestId: string
): Promise<ActionResult<PublicVenueRequestSummary | null>> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return { success: false, error: "Invalid request." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    const summary = await getPublicVenueRequestSummary(supabase, parsed.data);
    return { success: true, data: summary };
  } catch (error) {
    logServerError("venueRequests.publicSummary", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}

const linkSchema = z.object({
  requestIds: z.array(z.uuid()).min(1),
  venueId: z.uuid(),
});

export async function linkVenueRequestsAction(
  input: z.infer<typeof linkSchema>
): Promise<ActionResult<{ linked: number }>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid selection." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const { data, error } = await supabase.rpc("admin_link_venue_requests", {
      p_request_ids: parsed.data.requestIds,
      p_venue_id: parsed.data.venueId,
    });
    if (error) throw error;
    revalidatePath("/admin/venue-requests");
    return { success: true, data: { linked: data ?? 0 } };
  } catch (error) {
    logServerError("venueRequests.link", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't link that request.") };
  }
}

const statusSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(["contacted", "declined"]),
});

/**
 * The two states an admin actually sets by hand — restricted here (and again
 * inside admin_set_venue_request_cluster_status) so this action cannot set
 * 'listed' or 'duplicate', which nothing but the database itself should
 * assign.
 *
 * Operates on the whole CLUSTER, not the one row named by requestId — see
 * migration 20260810000106: "I contacted this venue" is a fact about the
 * place, not about whichever single request happens to be the admin view's
 * sample row. A single-row update would leave every other requester's row
 * 'open', and admin_venue_demand() would keep showing the cluster as
 * untouched.
 */
export async function setVenueRequestStatusAction(
  input: z.infer<typeof statusSchema>
): Promise<ActionResult<{ updated: number }>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid status." };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    const { data, error } = await supabase.rpc("admin_set_venue_request_cluster_status", {
      p_request_id: parsed.data.requestId,
      p_status: parsed.data.status,
    });
    if (error) throw error;
    revalidatePath("/admin/venue-requests");
    return { success: true, data: { updated: data ?? 0 } };
  } catch (error) {
    logServerError("venueRequests.setStatus", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}
