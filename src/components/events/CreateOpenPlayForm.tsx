"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, MapPin } from "lucide-react";
import { createOpenPlayForBookingAction } from "@/lib/actions/events";
import { PlayerPicker } from "@/components/court/PlayerPicker";
import { calculateSplit, formatShare } from "@/lib/eventSplit";
import type { HostableBooking } from "@/lib/services/events";
import type { PublicProfile } from "@/lib/supabase/types";

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
 * Opens a game on a court the organiser already holds.
 *
 * Only their own upcoming bookings are selectable — the events RLS policy
 * requires a live booking of the creator's own before an event can claim a
 * court, so anything else would be rejected at submit time. Bookings that
 * already host a game link straight to it rather than offering a duplicate.
 */
export function CreateOpenPlayForm({ bookings }: { bookings: HostableBooking[] }) {
  const available = bookings.filter((b) => !b.existingEventId);
  const [bookingId, setBookingId] = useState(available[0]?.bookingId ?? "");
  const [title, setTitle] = useState("");
  const [players, setPlayers] = useState<PublicProfile[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selected = bookings.find((b) => b.bookingId === bookingId);
  const split = selected ? calculateSplit(selected.priceAmount, players.length + 1) : null;

  function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!bookingId) return;

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

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
        <CalendarDays className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">You need a court first</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Open Play runs on a court you&apos;ve booked. Book one, then come back and invite your playmates.
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Which booking?</legend>
        <p className="text-xs text-muted-foreground">Open Play runs on a court you&apos;ve already booked and paid for.</p>
        <div className="mt-1 flex flex-col gap-2">
          {available.map((booking) => (
            <label
              key={booking.bookingId}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                bookingId === booking.bookingId ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="bookingId"
                value={booking.bookingId}
                checked={bookingId === booking.bookingId}
                onChange={() => setBookingId(booking.bookingId)}
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
          placeholder={selected ? `Open Play at ${selected.venueName}` : "Open Play"}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      {selected && (
        <PlayerPicker selected={players} onChange={setPlayers} totalAmount={selected.priceAmount} currency={selected.currency} />
      )}

      {/* Restated at the point of commitment, not just next to the picker —
          this is the last screen before other people get a notification
          saying they're in a game with a peso figure attached. */}
      {split && selected && selected.priceAmount > 0 && (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          You&apos;ve already paid {formatShare(selected.priceAmount, selected.currency)} for this court. Splitting it{" "}
          {split.playerCount} ways works out to {formatShare(split.sharePerPlayer, selected.currency)} each — collect that from
          your group directly, however you like.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || !bookingId}
        className="rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Creating…" : players.length > 0 ? `Create game and invite ${players.length}` : "Create game"}
      </button>
    </form>
  );
}
