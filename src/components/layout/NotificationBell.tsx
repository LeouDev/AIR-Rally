"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Bell, CalendarCheck, CalendarX, Star, Users, Coins, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { listNotifications, getUnreadCount } from "@/lib/services/notifications";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/lib/actions/notifications";
import type { Notification } from "@/lib/supabase/types";
import { notificationHref, displayMessage } from "@/lib/notificationRoutes";
import { cn } from "@/lib/utils";

type NotificationBellProps = {
  userId: string;
};

// Keyed loosely on purpose: the database emits more notification types
// than the NotificationType union lists (credits, invites, community), and
// an unknown type should fall back to a bell rather than fail to compile.
const ICONS: Record<string, typeof Bell> = {
  booking_confirmed: CalendarCheck,
  booking_created: CalendarCheck,
  booking_received: CalendarCheck,
  booking_cancelled: CalendarX,
  reschedule_completed: CalendarCheck,
  review_received: Star,
  credits_added: Coins,
  event_invite: Users,
};

/**
 * Fully client-side, like AuthNavSection/UserMenu — fetches its own
 * unread count on mount and its own recent-notifications list each time
 * the popover opens, rather than receiving server-fetched initial props.
 *
 * Opening the popover marks everything in it read, matching Facebook and
 * Instagram's bell: the badge is "you have unseen activity," not a running
 * total you clear item by item. There is deliberately no separate "Mark
 * all read" button anymore — by the time anyone could click it, opening
 * the popover has already done the same thing, which made the button a
 * no-op waiting to be clicked.
 *
 * No Realtime subscription in this pass, and no email/push — see
 * lib/services/notifications.ts and the Phase 5.3 brief.
 */
export function NotificationBell({ userId }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    getUnreadCount(supabase, userId)
      .then((count) => {
        if (!cancelled) setUnreadCount(count);
      })
      .catch(() => {
        // Best-effort — a failed count just leaves the badge hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleOpenChange(open: boolean) {
    if (!open || notifications !== null) return;
    setIsLoading(true);
    try {
      const supabase = createClient();
      const rows = await listNotifications(supabase, userId);
      const hadUnread = rows.some((n) => n.read_at === null);

      // Opening the bell IS "marking as seen" — the badge clears
      // immediately, optimistically, the same instant the list renders.
      const readAt = new Date().toISOString();
      const shown = hadUnread ? rows.map((n) => (n.read_at === null ? { ...n, read_at: readAt } : n)) : rows;
      setNotifications(shown);
      setUnreadCount(0);
      setIsLoading(false);

      if (hadUnread) {
        const result = await markAllNotificationsReadAction();
        if (!result.success) {
          // Revert — the badge should never claim "read" when the write
          // didn't actually happen.
          setNotifications(rows);
          setUnreadCount(rows.filter((n) => n.read_at === null).length);
        }
      }
    } catch {
      setNotifications([]);
      setIsLoading(false);
    }
  }

  async function handleMarkRead(notification: Notification) {
    // Opening the bell already marked every row read — this only still
    // does something for a notification reached from /notifications
    // (which fetches its own list independently of this component).
    if (notification.read_at !== null) return;

    const readAt = new Date().toISOString();
    setNotifications((prev) => prev?.map((n) => (n.id === notification.id ? { ...n, read_at: readAt } : n)) ?? prev);
    setUnreadCount((prev) => Math.max(0, prev - 1));

    const result = await markNotificationReadAction(notification.id);
    if (!result.success) {
      setNotifications((prev) => prev?.map((n) => (n.id === notification.id ? { ...n, read_at: null } : n)) ?? prev);
      setUnreadCount((prev) => prev + 1);
    }
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative inline-flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Bell className="size-4.5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium leading-none text-destructive-foreground"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">Notifications</p>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>}

          {!isLoading && notifications !== null && notifications.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          )}

          {!isLoading &&
            notifications?.map((notification) => {
              const Icon = ICONS[notification.type] ?? Bell;
              const isUnread = notification.read_at === null;
              return (
                // A link, not a button: the point of tapping a
                // notification is to get to the thing it is about. Marking
                // it read happens on the way through.
                <Link
                  key={notification.id}
                  href={notificationHref(notification)}
                  onClick={() => handleMarkRead(notification)}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted",
                    isUnread && "bg-primary/5"
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{notification.title}</span>
                      {isUnread && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    </span>
                    <span className="text-xs text-muted-foreground">{displayMessage(notification.message)}</span>
                    <span className="text-[11px] text-muted-foreground/80">
                      {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                    </span>
                  </span>
                </Link>
              );
            })}
        </div>

        {/* Always present, even when empty — "see everything" is the one
            thing a truncated popover must never hide. */}
        <div className="border-t border-border p-1">
          <Link
            href="/notifications"
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-muted"
          >
            See all notifications
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
