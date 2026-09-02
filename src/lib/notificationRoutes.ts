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
  // The trigger inserts type 'post_mention' (20260810000032), not
  // 'post_mentioned' — this key has to match that exactly or every
  // mention notification falls through to the generic /notifications
  // default below instead of landing on the post.
  post_mention: "/court-side",
  club_joined: "/clubs",
  club_approved: "/clubs",
  club_member_request: "/clubs",
  venue_approved: "/list-your-court",
  venue_suspended: "/list-your-court",
  event_invite: "/events",
  event_cancelled: "/events",
  // Both event_cancelled and event_moved are stamped with a precise
  // link_url by their triggers (20260810000078), so this fallback should
  // never actually be reached — it exists for a future writer that forgets.
  event_moved: "/events",
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
  // apply_ranked_result() (20260810000068_dupr_rating_engine.sql) stamps
  // every rank-change notification (calibration complete, tier/pip up or
  // down) with a bare '/ranked' link_url — there's no page at that exact
  // path, only /ranked/leaderboard, /ranked/match/[id], /ranked/new. Since
  // link_url otherwise wins over the TYPE_ROUTES fallback below (this row
  // always has one, so the fallback's own /profile/rank entries for these
  // types never actually run), that dead value has to be caught here
  // rather than relying on the fallback map to save it.
  if (notification.link_url && notification.link_url !== "/ranked" && !notification.link_url.startsWith("/ranked?")) {
    return notification.link_url;
  }
  if (notification.link_url === "/ranked" || notification.link_url?.startsWith("/ranked?")) {
    return "/profile/rank";
  }

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
