"use server";

import { revalidatePath } from "next/cache";
import { createEvent, joinEvent, leaveEvent, cancelEvent, approveEventJoin, rejectEventJoin } from "@/lib/services/events";
import { getBookingById } from "@/lib/services/bookings";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { z } from "zod";
import { createEventSchema, type CreateEventValues } from "@/lib/validations/event";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import type { CommunityEvent, EventAttendeeStatus } from "@/lib/supabase/types";

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
 * Joins or leaves an event, given the caller's current status (null if
 * they have no active row). "Attending" now covers three states —
 * pending_approval / joined / waitlisted — so this takes and returns the
 * real status rather than a joined/waitlisted pair of booleans.
 *
 * On join, the database decides the outcome: enforce_event_join_approval()
 * (20260810000069) gates a non-creator straight to pending_approval, and
 * for the creator's own event (or once approved) enforce_event_capacity()
 * decides joined vs waitlisted under its row lock. Either way the
 * assigned status is read back rather than assumed.
 */
export async function toggleEventJoinAction(
  eventId: string,
  currentStatus: EventAttendeeStatus | null
): Promise<ActionResult<{ status: EventAttendeeStatus | null }>> {
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
    if (currentStatus && currentStatus !== "cancelled") {
      await leaveEvent(supabase, user.id, eventId);
      revalidatePath("/court-side");
      return { success: true, data: { status: null } };
    }

    const status = await joinEvent(supabase, user.id, eventId);
    revalidatePath("/court-side");
    return { success: true, data: { status } };
  } catch (error) {
    logServerError("events.toggleJoin", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that.") };
  }
}

/** Approve or decline a pending join request. RLS restricts both to the
 * event's actual creator — a mismatched caller gets a policy rejection,
 * not a silent no-op. */
export async function respondToJoinRequestAction(
  eventId: string,
  requesterId: string,
  decision: "approve" | "reject"
): Promise<ActionResult<{ status: EventAttendeeStatus | null }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    if (decision === "approve") {
      const status = await approveEventJoin(supabase, eventId, requesterId);
      revalidatePath(`/events/${eventId}`);
      return { success: true, data: { status } };
    }
    await rejectEventJoin(supabase, eventId, requesterId);
    revalidatePath(`/events/${eventId}`);
    return { success: true, data: { status: null } };
  } catch (error) {
    logServerError("events.respondToJoinRequest", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that request.") };
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


const openPlaySchema = z.object({
  bookingId: z.uuid(),
  playerIds: z.array(z.uuid()).max(20).default([]),
  title: z.string().trim().min(1).max(120).optional(),
});

/**
 * Turns a just-created booking into an Open Play game and invites the
 * organiser's chosen playmates, in one step after checkout starts.
 *
 * Money is deliberately absent. The organiser has already paid (or is
 * paying) for the whole booking through the ordinary checkout — this
 * action never touches payment. price_amount is copied onto the event for
 * the share calculator only, and AIR/Rally collects nothing from joiners:
 * how the group settles up is entirely between them.
 *
 * Invited players are NOT enrolled. Each gets a notification and joins
 * with their own tap — the roster only ever contains people who agreed to
 * be on it.
 */
export async function createOpenPlayForBookingAction(values: {
  bookingId: string;
  playerIds: string[];
  title?: string;
}): Promise<ActionResult<{ eventId: string; invited: number }>> {
  const parsed = openPlaySchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "We couldn't set up that game." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to set up a game." };
  }

  try {
    // The booking anchors everything: court, time, price, and — via the
    // events RLS policy — proof the organiser actually holds this slot.
    const booking = await getBookingById(supabase, parsed.data.bookingId);
    if (!booking || booking.user_id !== user.id) {
      return { success: false, error: "We couldn't find that booking." };
    }
    if (booking.status === "cancelled") {
      return { success: false, error: "That booking was cancelled." };
    }

    const display = await getCourtDisplayInfo(supabase, booking.court_id);
    const venueName = display?.venueName ?? "the venue";

    const event = await createEvent(supabase, user.id, {
      title: parsed.data.title ?? `Open Play at ${venueName}`,
      startTime: booking.start_time,
      endTime: booking.end_time,
      eventType: "open_play",
      courtId: booking.court_id,
      bookingId: booking.id,
      // Party size = organiser + invited players. Others can still join up
      // to this cap; the organiser can be more generous by inviting more.
      maxPlayers: Math.max(parsed.data.playerIds.length + 1, 2),
      priceAmount: booking.price_amount,
    });

    // The organiser is on their own roster — they're playing too, and the
    // share calculator divides by everyone including them.
    await joinEvent(supabase, user.id, event.id);

    let invited = 0;
    if (parsed.data.playerIds.length > 0) {
      const { data, error } = await supabase.rpc("invite_event_players", {
        p_event_id: event.id,
        p_user_ids: parsed.data.playerIds,
      });
      if (error) throw error;
      invited = data ?? 0;
    }

    revalidatePath("/events");
    return { success: true, data: { eventId: event.id, invited } };
  } catch (error) {
    logServerError("events.createOpenPlay", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't set up that game.") };
  }
}
