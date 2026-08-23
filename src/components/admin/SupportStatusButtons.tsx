"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setSupportRequestStatusAction } from "@/lib/actions/reports";
import type { SupportStatus } from "@/lib/supabase/types";

const NEXT_STATES: Record<SupportStatus, { value: SupportStatus; label: string }[]> = {
  open: [
    { value: "in_progress", label: "Start" },
    { value: "resolved", label: "Resolve" },
  ],
  in_progress: [
    { value: "resolved", label: "Resolve" },
    { value: "closed", label: "Close" },
  ],
  // Reopening clears resolved_by/resolved_at/resolution_note in the
  // service, because the support_resolution_complete CHECK would
  // otherwise leave the row claiming a resolver — and a reply — it no
  // longer has.
  resolved: [{ value: "open", label: "Reopen" }],
  closed: [{ value: "open", label: "Reopen" }],
};

// Only these two terminal states need a reply — Start/Reopen just move
// the request along and carry no message, matching
// support_resolution_complete's own scope (20260810000088).
const NEEDS_NOTE = new Set<SupportStatus>(["resolved", "closed"]);

export function SupportStatusButtons({ requestId, status }: { requestId: string; status: SupportStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<SupportStatus | null>(null);
  const [drafting, setDrafting] = useState<SupportStatus | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function move(next: SupportStatus, resolutionNote?: string) {
    setPending(next);
    setError(null);
    const result = await setSupportRequestStatusAction(requestId, next, resolutionNote);
    setPending(null);

    if (!result.success) {
      if (NEEDS_NOTE.has(next)) {
        setError(result.error);
      } else {
        toast.error(result.error);
      }
      return;
    }
    setDrafting(null);
    setNote("");
    toast.success(next === "resolved" || next === "closed" ? "Reply sent." : "Updated.");
    router.refresh();
  }

  if (drafting) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write the reply the player will see in their notifications…"
          rows={3}
          maxLength={1000}
          autoFocus
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => move(drafting, note.trim())}
            disabled={pending !== null || note.trim().length === 0}
          >
            {pending === drafting ? "Sending…" : drafting === "resolved" ? "Send & resolve" : "Send & close"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDrafting(null);
              setNote("");
              setError(null);
            }}
            disabled={pending !== null}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {NEXT_STATES[status].map((option, i) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={i === 0 ? "default" : "outline"}
          onClick={() => (NEEDS_NOTE.has(option.value) ? setDrafting(option.value) : move(option.value))}
          disabled={pending !== null}
        >
          {pending === option.value ? "Saving…" : option.label}
        </Button>
      ))}
    </div>
  );
}
