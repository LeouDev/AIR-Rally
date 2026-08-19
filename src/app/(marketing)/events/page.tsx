import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listUpcomingEvents, listMyEventStatuses } from "@/lib/services/events";
import { calculateSplit, formatShare } from "@/lib/eventSplit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open Play" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EventsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  const events = await listUpcomingEvents(supabase, 50);

  const myStatuses = user
    ? await listMyEventStatuses(supabase, user.id, events.map((e) => e.id))
    : new Map<string, never>();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Open Play</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Games with open spots. One player books the court — everyone sorts out the split between themselves.
          </p>
        </div>
        {user && (
          <Link
            href="/events/new"
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Start a game
          </Link>
        )}
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
          <CalendarDays className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No games coming up</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Book a court and add your playmates — your game shows up here for others to join.
          </p>
          <Link
            href="/explore"
            className="mt-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Find a court
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {events.map((event) => {
            // The share preview divides by everyone seated, organiser
            // included. Purely informational — nobody is charged here.
            const split = calculateSplit(event.price_amount, Math.max(event.attendeeCount, 1));
            const myStatus = myStatuses.get(event.id) ?? null;

            return (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-foreground">{event.title}</h2>
                    {myStatus === "joined" && (
                      <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                        You&apos;re in
                      </span>
                    )}
                    {myStatus === "waitlisted" && (
                      <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                        Waitlisted
                      </span>
                    )}
                    {myStatus === "pending_approval" && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Requested
                      </span>
                    )}
                  </div>

                  <dl className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                      <dd>{formatWhen(event.start_time)}</dd>
                    </div>
                    {event.venue && (
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 shrink-0" aria-hidden="true" />
                        <dd className="truncate">
                          {event.venue.name}
                          {event.venue.city ? `, ${event.venue.city}` : ""}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Users className="size-4 shrink-0" aria-hidden="true" />
                      <dd>
                        {event.attendeeCount}
                        {event.max_players ? ` / ${event.max_players}` : ""} playing
                        {event.isFull && " · full"}
                      </dd>
                    </div>
                  </dl>

                  {event.price_amount > 0 && (
                    <p className="mt-auto text-sm text-foreground">
                      <span className="font-semibold">{formatShare(split.sharePerPlayer)}</span>{" "}
                      <span className="text-muted-foreground">each if split {split.playerCount} ways</span>
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
