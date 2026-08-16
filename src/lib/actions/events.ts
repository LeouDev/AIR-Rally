"use server";

import { revalidatePath } from "next/cache";
import { createEvent, joinEvent, leaveEvent, cancelEvent } from "@/lib/services/events";
import { createEventSchema, type CreateEventValues } from "@/lib/validations/event";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import type { CommunityEvent } from "@/lib/supabase/types";

export async function createEventAction(values: CreateEventValues): Promise<ActionResult<CommunityEvent>> {
  const parsed = createEventSchema.safeParse(values);
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
    return { success: false, error: "Sign in to create an event." };
  }

  try {
    const event = await createEvent(supabase, user.id, parsed.data);
    revalidatePath("/court-side");
    return { success: true, data: event };
  } catch (error) {
    logServerError("events.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't create that event.") };
  }
}

/**
 * Joins or leaves an event. On join, the database decides whether the
 * caller gets a seat or the waitlist (enforce_event_capacity() holds a
 * row lock so concurrent joins can't both claim the last seat), so the
 * assigned status is read back rather than assumed.
 */
export async function toggleEventJoinAction(
  eventId: string,
  currentlyJoined: boolean
): Promise<ActionResult<{ joined: boolean; waitlisted: boolean }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to join events." };
  }

  try {
    if (currentlyJoined) {
      await leaveEvent(supabase, user.id, eventId);
      revalidatePath("/court-side");
      return { success: true, data: { joined: false, waitlisted: false } };
    }

    const status = await joinEvent(supabase, user.id, eventId);
    revalidatePath("/court-side");
    return { success: true, data: { joined: true, waitlisted: status === "waitlisted" } };
  } catch (error) {
    logServerError("events.toggleJoin", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that.") };
  }
}

export async function cancelEventAction(eventId: string): Promise<ActionResult<null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };

  try {
    // RLS restricts event updates to the creator (or an admin), and the
    // notify_on_event_cancelled() trigger tells every attendee.
    await cancelEvent(clientResult.client, eventId);
    revalidatePath("/court-side");
    return { success: true, data: null };
  } catch (error) {
    logServerError("events.cancel", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't cancel that event.") };
  }
}
