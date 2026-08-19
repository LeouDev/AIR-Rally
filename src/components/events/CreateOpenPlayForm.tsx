"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, MapPin } from "lucide-react";
import { createOpenPlayForBookingAction } from "@/lib/actions/events";
import { createRankedMatchAction } from "@/lib/actions/ranked";
import { PlayerPicker } from "@/components/court/PlayerPicker";
import { RankedPartyBuilder } from "@/components/ranked/RankedPartyBuilder";
import { RankBadge } from "@/components/ranked/RankBadge";
import { rankLabel } from "@/lib/ranked";
import { calculateSplit, formatShare } from "@/lib/eventSplit";
import type { HostableBooking } from "@/lib/services/events";
import type { PlayerRank, PublicProfile, RankedMatchType } from "@/lib/supabase/types";

type CreationMode = "casual" | "ranked";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Opens a game on a court the organiser already holds — casual (an
 * ordinary Open Play event) or Ranked (the same event, plus a ranked
 * match struck on it). Only their own upcoming bookings are selectable —
 * the events RLS policy requires a live booking of the creator's own
 * before an event can claim a court, so anything else would be rejected
 * at submit time. Bookings that already host a game link straight to it
 * rather than offering a duplicate.
 *
 * The Casual and Ranked branches diverge past the shared booking/title
 * fields on purpose rather than sharing one picker: Open Play's roster is
 * a loose, RSVP-based invite list (`PlayerPicker`, up to 20, waitlist-
 * aware), while a ranked party is an exact 2- or 4-slot roster
 * (`RankedPartyBuilder`) assigned to teams up front — different enough
 * shapes that forcing them into one component would be worse than two.
 */
export function CreateOpenPlayForm({
  bookings,
  host,
  hostRank,
  initialMode = "casual",
}: {
  bookings: HostableBooking[];
  host: PublicProfile;
  hostRank: PlayerRank | null;
  initialMode?: CreationMode;
}) {
  const available = bookings.filter((b) => !b.existingEventId);
  const [mode, setMode] = useState<CreationMode>(initialMode);
  const [bookingId, setBookingId] = useState(available[0]?.bookingId ?? "");
  const [title, setTitle] = useState("");
  const [players, setPlayers] = useState<PublicProfile[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selected = bookings.find((b) => b.bookingId === bookingId);
  const split = selected ? calculateSplit(selected.priceAmount, players.length + 1) : null;

  function handleCasualSubmit() {
    if (!bookingId || isPending) return;
    startTransition(async () => {
      const result = await createOpenPlayForBookingAction({
        bookingId,
        playerIds: players.map((p) => p.id),
        title: title.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.invited > 0
          ? `Game created — ${result.data.invited} player(s) invited.`
          : "Game created. Share it so others can join."
      );
      router.push(`/events/${result.data.eventId}`);
    });
  }

  // Deliberately NOT wrapped in the parent's own startTransition/isPending:
  // RankedPartyBuilder already wraps its call to `onSubmit` in its OWN
  // transition (its "Starting match…" button state), and since that
  // wrapper `await`s this function, this has to genuinely stay pending
  // for the real work's duration — a fire-and-forget startTransition
  // here would let this function return (and the child's own pending
  // state clear) the instant it's scheduled, not once the two composed
  // action calls actually finish, which would let a double-click slip a
  // second submission through underneath the first.
  async function handleRankedSubmit(party: { matchType: RankedMatchType; teamA: string[]; teamB: string[] }) {
    if (!bookingId || !selected) return;
    // Captured up front, not read from state again after the first await —
    // the booking/title inputs stay interactive during submit (there's no
    // parent-level pending flag to disable them for this branch), so a
    // self-consistent snapshot is what actually keeps the two composed
    // action calls correct if the organiser touches the form mid-flight.
    const bookingIdSnapshot = bookingId;
    const courtIdSnapshot = selected.courtId;
    const titleSnapshot = title.trim() || undefined;
    const otherPlayerIds = [...party.teamA, ...party.teamB].filter((id) => id !== host.id);

    const eventResult = await createOpenPlayForBookingAction({
      bookingId: bookingIdSnapshot,
      playerIds: otherPlayerIds,
      title: titleSnapshot,
    });
    if (!eventResult.success) {
      toast.error(eventResult.error);
      return;
    }
    const matchResult = await createRankedMatchAction({
      matchType: party.matchType,
      teamA: party.teamA,
      teamB: party.teamB,
      eventId: eventResult.data.eventId,
      courtId: courtIdSnapshot,
    });
    if (!matchResult.success) {
      // The event exists as an ordinary Casual game even though the
      // match didn't start — not a dead end, the same recovery path as
      // any other event without a match yet (its own "Start a Ranked
      // match here" bridge).
      toast.error(matchResult.error);
      router.push(`/events/${eventResult.data.eventId}`);
      return;
    }
    router.push(`/ranked/match/${matchResult.data.matchId}`);
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
        <CalendarDays className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">You need a court first</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Play runs on a court you&apos;ve booked. Book one, then come back and invite your playmates.
        </p>
        <Link
          href="/explore"
          className="mt-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Find a court
        </Link>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
        <p className="text-sm font-medium text-foreground">Every upcoming booking already has a game</p>
        <ul className="flex flex-col gap-2">
          {bookings.map((booking) => (
            <li key={booking.bookingId}>
              <Link href={`/events/${booking.existingEventId}`} className="text-sm text-primary hover:underline">
                {booking.venueName} · {formatWhen(booking.startTime)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">What kind of game?</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode("casual")}
            disabled={isPending}
            className={`rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${
              mode === "casual" ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
            }`}
          >
            <span className="block text-sm font-semibold text-foreground">Fun Dink</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Casual — no rank impact.</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("ranked")}
            disabled={isPending}
            className={`rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${
              mode === "ranked" ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              AIR/Rally Ranked
              {hostRank?.is_calibrated && <RankBadge tier={hostRank.tier} size={20} />}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {hostRank?.is_calibrated ? `You're ${rankLabel(hostRank.tier, hostRank.pips)}.` : "Competitive — win pips, climb tiers."}
            </span>
          </button>
        </div>
        {mode === "ranked" && (
          <p className="mt-2 text-xs text-muted-foreground">
            This match affects your AIR/Rally Rank — your rating moves based on performance against expectation, not just the
            final score.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Which booking?</legend>
        <p className="text-xs text-muted-foreground">Play runs on a court you&apos;ve already booked and paid for.</p>
        <div className="mt-1 flex flex-col gap-2">
          {available.map((booking) => (
            <label
              key={booking.bookingId}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                bookingId === booking.bookingId ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
              } ${isPending ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="bookingId"
                value={booking.bookingId}
                checked={bookingId === booking.bookingId}
                onChange={() => setBookingId(booking.bookingId)}
                disabled={isPending}
                className="mt-1 size-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {booking.venueName} · {booking.courtName}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {formatWhen(booking.startTime)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {formatShare(booking.priceAmount, booking.currency)} court total
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-title" className="text-sm font-medium text-foreground">
          Game name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="event-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          disabled={isPending}
          placeholder={selected ? `Open Play at ${selected.venueName}` : "Open Play"}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
      </div>

      {mode === "casual" ? (
        <>
          {selected && (
            <PlayerPicker selected={players} onChange={setPlayers} totalAmount={selected.priceAmount} currency={selected.currency} />
          )}

          {/* Restated at the point of commitment, not just next to the picker —
              this is the last screen before other people get a notification
              saying they're in a game with a peso figure attached. */}
          {split && selected && selected.priceAmount > 0 && (
            <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
              You&apos;ve already paid {formatShare(selected.priceAmount, selected.currency)} for this court. Splitting it{" "}
              {split.playerCount} ways works out to {formatShare(split.sharePerPlayer, selected.currency)} each — collect that
              from your group directly, however you like.
            </p>
          )}

          <button
            type="button"
            onClick={handleCasualSubmit}
            disabled={isPending || !bookingId}
            className="rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Creating…" : players.length > 0 ? `Create game and invite ${players.length}` : "Create game"}
          </button>
        </>
      ) : (
        <RankedPartyBuilder
          host={host}
          hostRank={hostRank}
          initialMatchType="singles"
          onSubmit={handleRankedSubmit}
          submitLabel="Create game"
        />
      )}
    </div>
  );
}
