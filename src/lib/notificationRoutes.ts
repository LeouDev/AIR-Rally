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
  // Ranked notifications set link_url themselves (usually straight to the
  // match), so these are only reached for a row some future writer forgets
  // to stamp — see 20260810000067_air_rally_ranked.sql.
  ranked_match_found: "/profile/rank",
  ranked_officiating_confirmed: "/profile/rank",
  ranked_result_submitted: "/profile/rank",
  ranked_result_confirmed: "/profile/rank",
  ranked_result_disputed: "/profile/rank",
  ranked_dispute_resolved: "/profile/rank",
  ranked_rank_up: "/profile/rank",
  ranked_rank_down: "/profile/rank",
  ranked_pip_gained: "/profile/rank",
  ranked_pip_lost: "/profile/rank",
  ranked_star_protected: "/profile/rank",
  ranked_calibration_complete: "/profile/rank",
};

/** Pulls `[event:<uuid>]` out of a message body. */
function embeddedEventId(message: string): string | null {
  const match = message.match(/\[event:([0-9a-f-]{36})\]/i);
  return match ? match[1] : null;
}

export function notificationHref(notification: { type: string; message: Notification["message"]; link_url?: string | null }): string {
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
export function notificationCategory(type: string): "bookings" | "community" | "ranked" | "account" {
  if (type.startsWith("booking") || type.startsWith("reschedule") || type.startsWith("event")) return "bookings";
  if (type.startsWith("post") || type.startsWith("club")) return "community";
  if (type.startsWith("ranked")) return "ranked";
  return "account";
}
