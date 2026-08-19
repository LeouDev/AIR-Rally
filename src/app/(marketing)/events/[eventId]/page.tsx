import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, MapPin, Users, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listMyEventStatuses, listPendingJoinRequests } from "@/lib/services/events";
import { calculateSplit, formatShare } from "@/lib/eventSplit";
import { EventJoinButton } from "@/components/events/EventJoinButton";
import { EventJoinRequests } from "@/components/events/EventJoinRequests";
import { matchStatusLabel } from "@/lib/ranked";
import type { CommunityEvent, PublicProfile } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";

/** Non-terminal — the set a "still going" link should resolve to. */
const ACTIVE_RANKED_STATUSES = ["lobby", "officiating", "live", "awaiting_confirmation"];

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Game" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!event) notFound();
  const game = event as CommunityEvent;

  const [{ data: creator }, { data: venue }, { data: attendeeRows }, { data: rankedMatches }] = await Promise.all([
    supabase.from("public_profiles").select("*").eq("id", game.creator_id).maybeSingle(),
    game.venue_id
      ? supabase.from("venues").select("id, name, city").eq("id", game.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("event_attendees").select("user_id, status").eq("event_id", game.id).eq("status", "joined"),
    // Not unique per event (a rematch, or several games across one long
    // session), so this has to pick the active one, not just check
    // existence. RLS (ranked_matches' SELECT policy) means a match still
    // in progress only comes back here for its own participants/creator/
    // scorekeeper/admin — a fellow attendee who isn't in that particular
    // match sees nothing and still gets the "start one" bridge below,
    // even though one is already underway elsewhere in this session.
    // Pre-existing scope limit, not something this query introduces.
    supabase
      .from("ranked_matches")
      .select("id, status")
      .eq("event_id", game.id)
      .order("created_at", { ascending: false }),
  ]);
  const activeRankedMatch = (rankedMatches ?? []).find((m) => ACTIVE_RANKED_STATUSES.includes(m.status));

  const attendeeIds = (attendeeRows ?? []).map((a) => a.user_id);
  const { data: attendees } = attendeeIds.length
    ? await supabase.from("public_profiles").select("*").in("id", attendeeIds)
    : { data: [] as PublicProfile[] };

  const myStatus = user ? (await listMyEventStatuses(supabase, user.id, [game.id])).get(game.id) ?? null : null;
  const seated = Math.max(attendeeIds.length, 1);
  const split = calculateSplit(game.price_amount, seated);
  const isFull = game.max_players !== null && attendeeIds.length >= game.max_players;
  const isOrganiser = user?.id === game.creator_id;
  const pendingRequests = isOrganiser ? await listPendingJoinRequests(supabase, game.id) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <BackLink href="/events" label="Back to open play" />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{game.title}</h1>
        {creator && (
          <p className="mt-1 text-sm text-muted-foreground">
            Organised by {creator.display_name ?? "a player"}
            {isOrganiser && " (you)"}
          </p>
        )}
      </div>

      <dl className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 text-sm">
        <div className="flex items-center gap-2 text-foreground">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd>{formatWhen(game.start_time)}</dd>
        </div>
        {venue && (
          <div className="flex items-center gap-2 text-foreground">
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <dd>
              {venue.name}
              {venue.city ? `, ${venue.city}` : ""}
            </dd>
          </div>
        )}
        <div className="flex items-center gap-2 text-foreground">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd>
            {attendeeIds.length}
            {game.max_players ? ` of ${game.max_players}` : ""} playing
            {isFull && " · full"}
          </dd>
        </div>
      </dl>

      {game.description && <p className="text-sm text-muted-foreground">{game.description}</p>}

      {/* The share, and an unambiguous statement about who collects it.
          A peso figure next to a roster reads as a bill unless you say
          otherwise — and AIR/Rally bills nobody here but the organiser. */}
      {game.price_amount > 0 && (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <p className="text-sm text-muted-foreground">Court total</p>
          <p className="text-lg font-semibold text-foreground">{formatShare(game.price_amount)}</p>
          <p className="mt-2 text-sm text-foreground">
            <span className="font-semibold">{formatShare(split.sharePerPlayer)}</span> each, split {split.playerCount} ways
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {creator?.display_name ?? "The organiser"} paid the venue for the whole court. Settle your share directly with them —
            AIR/Rally doesn&apos;t collect it.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Playing</h2>
        {attendees && attendees.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {attendees.map((player) => (
              <li
                key={player.id}
                className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1 text-sm"
              >
                <span className="grid size-6 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                  {(player.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="text-foreground">{player.display_name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody has confirmed yet.</p>
        )}
      </div>

      {activeRankedMatch ? (
        <Link
          href={`/ranked/match/${activeRankedMatch.id}`}
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          <span>Ranked match: {matchStatusLabel({ status: activeRankedMatch.status })}</span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        // Only once you're actually on this court and in the game — a
        // ranked match needs a real party, not just an interested visitor.
        user &&
        game.court_id &&
        (myStatus === "joined" || isOrganiser) && (
          <Link
            href={`/ranked/new?event=${game.id}&court=${game.court_id}`}
            className="rounded-full border border-border px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-muted"
          >
            Start a Ranked match here
          </Link>
        )
      )}

      {isOrganiser && <EventJoinRequests eventId={game.id} requests={pendingRequests} />}

      {user ? (
        <EventJoinButton eventId={game.id} status={myStatus} isFull={isFull} isOrganiser={isOrganiser} />
      ) : (
        <Link
          href={`/login?redirect=/events/${game.id}`}
          className="rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Sign in to join
        </Link>
      )}
    </div>
  );
}
