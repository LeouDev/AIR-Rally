import type { Notification } from "@/lib/supabase/types";

/**
 * Where tapping a notification should take you.
 *
 * Resolution order:
 *   1. `link_url` on the row — set by newer notification writers, and the
 *      only precise answer.
 *   2. A uuid embedded in the message as `[event:<id>]`, for the invite
 *      notifications that carry one.
 *   3. A best-effort route for the notification's type.
 *
 * The fallback exists because notifications predating `link_url` have no
 * destination stored, and sending someone to the right *section* is far
 * better than a dead tap. As older writers gain `link_url`, step 3 stops
 * being reached for those types.
 */
const TYPE_ROUTES: Record<string, string> = {
  booking_confirmed: "/bookings",
  booking_created: "/bookings",
  booking_received: "/list-your-court/bookings",
  booking_cancelled: "/bookings",
  reschedule_completed: "/bookings",
  review_received: "/list-your-court/overview",
  credits_added: "/profile/credits",
  post_liked: "/court-side",
  post_reshared: "/court-side",
  post_mentioned: "/court-side",
  club_joined: "/clubs",
  club_approved: "/clubs",
  club_member_request: "/clubs",
  venue_approved: "/list-your-court",
  venue_suspended: "/list-your-court",
  event_invite: "/events",
  event_cancelled: "/events",
};

/** Pulls `[event:<uuid>]` out of a message body. */
function embeddedEventId(message: string): string | null {
  const match = message.match(/\[event:([0-9a-f-]{36})\]/i);
  return match ? match[1] : null;
}

export function notificationHref(notification: Pick<Notification, "type" | "message"> & { link_url?: string | null }): string {
  if (notification.link_url) return notification.link_url;

  const eventId = embeddedEventId(notification.message ?? "");
  if (eventId) return `/events/${eventId}`;

  return TYPE_ROUTES[notification.type] ?? "/notifications";
}

/**
 * The message with its machine-readable marker removed. `[event:<uuid>]`
 * is routing metadata, not something a person should ever read.
 */
export function displayMessage(message: string): string {
  return message.replace(/\s*\[event:[0-9a-f-]{36}\]\s*/i, " ").trim();
}

/** Coarse grouping for the notification list's filter tabs. */
export function notificationCategory(type: string): "bookings" | "community" | "account" {
  if (type.startsWith("booking") || type.startsWith("reschedule") || type.startsWith("event")) return "bookings";
  if (type.startsWith("post") || type.startsWith("club")) return "community";
  return "account";
}
