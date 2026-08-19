"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { respondToJoinRequestAction } from "@/lib/actions/events";
import type { PendingJoinRequest } from "@/lib/services/events";

/** The event creator's queue of pending join requests. Approve seats them
 * (or waitlists them, if the event filled up while the request sat
 * pending) via enforce_event_capacity(); decline sets them to cancelled,
 * identical to a player leaving on their own. */
export function EventJoinRequests({ eventId, requests }: { eventId: string; requests: PendingJoinRequest[] }) {
  const [isPending, startTransition] = useTransition();
  const [actingOn, setActingOn] = useState<string | null>(null);
  const router = useRouter();

  if (requests.length === 0) return null;

  function respond(requesterId: string, decision: "approve" | "reject") {
    setActingOn(requesterId);
    startTransition(async () => {
      const result = await respondToJoinRequestAction(eventId, requesterId, decision);
      setActingOn(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        decision === "reject"
          ? "Request declined."
          : result.data.status === "waitlisted"
            ? "Approved — they landed on the waitlist, the game is full."
            : "Approved — they're in."
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">
        Join requests <span className="text-muted-foreground">({requests.length})</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <li key={request.userId} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {(request.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {request.profile?.display_name ?? "A player"}
            </span>
            <button
              type="button"
              disabled={isPending && actingOn === request.userId}
              onClick={() => respond(request.userId, "approve")}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={isPending && actingOn === request.userId}
              onClick={() => respond(request.userId, "reject")}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
