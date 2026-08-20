/**
 * @jest-environment node
 */
import { notificationHref, displayMessage, notificationCategory } from "../notificationRoutes";

function makeNotification(overrides: Partial<{ type: string; message: string; link_url: string | null }> = {}) {
  return {
    type: "booking_confirmed",
    message: "Your booking is confirmed.",
    link_url: null,
    ...overrides,
  } as Parameters<typeof notificationHref>[0];
}

describe("notificationHref", () => {
  // The precise answer always wins over any inference.
  it("prefers link_url above everything else", () => {
    const href = notificationHref(makeNotification({ link_url: "/events/abc", type: "booking_confirmed" }));
    expect(href).toBe("/events/abc");
  });

  it("falls back to an event id embedded in the message", () => {
    const href = notificationHref(
      makeNotification({
        type: "event_invite",
        message: "Lea added you to a game. [event:11111111-1111-4111-8111-111111111111]",
      })
    );
    expect(href).toBe("/events/11111111-1111-4111-8111-111111111111");
  });

  // Notifications written before link_url existed still have to go
  // somewhere sensible rather than nowhere.
  it.each([
    ["booking_confirmed", "/bookings"],
    ["booking_received", "/list-your-court/bookings"],
    ["credits_added", "/profile/credits"],
    ["post_liked", "/court-side"],
    ["post_reshared", "/court-side"],
    ["post_mention", "/court-side"],
    ["club_approved", "/clubs"],
    ["event_invite", "/events"],
  ])("routes a legacy %s to %s", (type, expected) => {
    expect(notificationHref(makeNotification({ type }))).toBe(expected);
  });

  it("never returns a dead link for an unknown type", () => {
    expect(notificationHref(makeNotification({ type: "something_new" }))).toBe("/notifications");
  });

  // apply_ranked_result() (20260810000068_dupr_rating_engine.sql) stamps
  // every rank-change notification with a bare '/ranked' link_url. There's
  // no page at that exact path — only /ranked/leaderboard, /ranked/match/
  // [id], /ranked/new — so returning it verbatim (link_url otherwise wins
  // over everything) would be a dead link straight from a real
  // notification, not a fallback case.
  it.each(["ranked_calibration_complete", "ranked_rank_up", "ranked_rank_down", "ranked_pip_gained", "ranked_pip_lost"])(
    "redirects the dead bare /ranked link_url to /profile/rank for %s",
    (type) => {
      expect(notificationHref(makeNotification({ type, link_url: "/ranked" }))).toBe("/profile/rank");
    }
  );

  it("still honors a real /ranked/match/... link_url unchanged", () => {
    expect(
      notificationHref(
        makeNotification({ type: "ranked_match_found", link_url: "/ranked/match/11111111-1111-4111-8111-111111111111" })
      )
    ).toBe("/ranked/match/11111111-1111-4111-8111-111111111111");
  });
});

describe("displayMessage", () => {
  // The marker is routing metadata. Showing it to a person would look like
  // a bug, because it is one.
  it("strips the event marker", () => {
    expect(displayMessage("Lea added you to a game. [event:11111111-1111-4111-8111-111111111111]")).toBe(
      "Lea added you to a game."
    );
  });

  it("leaves an ordinary message untouched", () => {
    expect(displayMessage("Your booking is confirmed.")).toBe("Your booking is confirmed.");
  });
});

describe("notificationCategory", () => {
  it.each([
    ["booking_confirmed", "bookings"],
    ["reschedule_completed", "bookings"],
    ["event_invite", "bookings"],
    ["post_liked", "community"],
    ["club_approved", "community"],
    ["credits_added", "account"],
    ["review_received", "account"],
    ["ranked_rank_up", "ranked"],
    ["ranked_result_confirmed", "ranked"],
  ])("puts %s under %s", (type, expected) => {
    expect(notificationCategory(type)).toBe(expected);
  });
});
