"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toggleEventJoinAction } from "@/lib/actions/events";

/**
 * Join / leave a game.
 *
 * The database decides whether a join takes a seat or the waitlist —
 * enforce_event_capacity() holds a row lock so two people can't both claim
 * the last spot — so the result is read back rather than assumed. That's
 * why a full game still shows a join button: joining puts you on the
 * waitlist, and auto-promotion moves you up when someone drops.
 */
export function EventJoinButton({
  eventId,
  joined,
  isFull,
  isOrganiser,
}: {
  eventId: string;
  joined: boolean;
  isFull: boolean;
  isOrganiser: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (isOrganiser) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
        You&apos;re organising this game.
      </p>
    );
  }

  function handleClick() {
    startTransition(async () => {
      const result = await toggleEventJoinAction(eventId, joined);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.waitlisted
          ? "You're on the waitlist — we'll move you up if a spot opens."
          : result.data.joined
            ? "You're in. Sort out your share with the organiser."
            : "You've left this game."
      );
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`rounded-full px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 ${
        joined ? "border border-border bg-card text-foreground" : "bg-primary text-primary-foreground"
      }`}
    >
      {isPending ? "Working…" : joined ? "Leave this game" : isFull ? "Join the waitlist" : "Join this game"}
    </button>
  );
}
