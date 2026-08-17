import Link from "next/link";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/lib/services/notifications";
import { notificationHref, displayMessage, notificationCategory } from "@/lib/notificationRoutes";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "bookings", label: "Games" },
  { value: "community", label: "Community" },
  { value: "account", label: "Account" },
] as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireSignedIn("/notifications");
  const supabase = await createClient();
  const all = await listNotifications(supabase, user.id, 100);

  const { filter } = await searchParams;
  const active = FILTERS.find((f) => f.value === filter)?.value ?? "all";
  const notifications = active === "all" ? all : all.filter((n) => notificationCategory(n.type) === active);
  const unreadCount = all.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
          </p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter notifications">
        {FILTERS.map((f) => {
          const isActive = f.value === active;
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/notifications" : `/notifications?filter=${f.value}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
          <Bell className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Nothing here yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Bookings, invites, and activity on your posts will show up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((notification) => (
            <li key={notification.id}>
              {/* The whole row is the link — a notification you can see but
                  not act on is the most common complaint about these lists. */}
              <Link
                href={notificationHref(notification)}
                className={`flex gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  notification.read_at ? "border-border bg-card" : "border-primary/30 bg-primary/5"
                }`}
              >
                {/* Unread marker: a dot, not a colour alone, so it survives
                    colour-blindness and greyscale. */}
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read_at ? "bg-transparent" : "bg-primary"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={`text-sm ${notification.read_at ? "font-medium" : "font-semibold"} text-foreground`}>
                      {notification.title}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">{relativeTime(notification.created_at)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{displayMessage(notification.message)}</span>
                  {!notification.read_at && <span className="sr-only">Unread</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
