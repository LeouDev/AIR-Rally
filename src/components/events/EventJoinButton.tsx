"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toggleEventJoinAction } from "@/lib/actions/events";
import type { EventAttendeeStatus } from "@/lib/supabase/types";

/**
 * Join / leave a game — now a 4-state control, not a toggle. A join no
 * longer lands a seat directly: enforce_event_join_approval()
 * (20260810000069) gates every non-creator join to pending_approval
 * first, and the event's creator approves or declines it. The database
 * still decides joined vs waitlisted once approved — enforce_event_capacity()
 * holds a row lock so two people can't both claim the last spot — so the
 * result is read back rather than assumed, same as before.
 */
export function EventJoinButton({
  eventId,
  status,
  isFull,
  isOrganiser,
}: {
  eventId: string;
  status: EventAttendeeStatus | null;
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
      const result = await toggleEventJoinAction(eventId, status);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const next = result.data.status;
      toast.success(
        next === "waitlisted"
          ? "You're on the waitlist — we'll move you up if a spot opens."
          : next === "joined"
            ? "You're in. Sort out your share with the organiser."
            : next === "pending_approval"
              ? "Request sent — the organiser will review it."
              : status === "pending_approval"
                ? "Request withdrawn."
                : "You've left this game."
      );
      router.refresh();
    });
  }

  const active = status === "joined" || status === "waitlisted" || status === "pending_approval";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`rounded-full px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 ${
        active ? "border border-border bg-card text-foreground" : "bg-primary text-primary-foreground"
      }`}
    >
      {isPending
        ? "Working…"
        : status === "pending_approval"
          ? "Cancel request"
          : status === "waitlisted"
            ? "Leave the waitlist"
            : status === "joined"
              ? "Leave this game"
              : isFull
                ? "Ask to join the waitlist"
                : "Ask to join"}
    </button>
  );
}
