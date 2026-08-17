"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setVenueStatusAction } from "@/lib/actions/venue";
import type { VenueStatus } from "@/lib/supabase/types";

type SubmitVenueForReviewProps = {
  venueId: string;
  status: VenueStatus;
  /** Checklist items still outstanding, so the owner knows what to fix first. */
  blockingItems: string[];
};

/**
 * Sends a draft venue to AIR/Rally for approval.
 *
 * This is the step that was missing entirely: a venue could be drafted and
 * completed with no way to submit it, so it sat in draft forever and never
 * reached the admin queue.
 *
 * Submitting is allowed with items outstanding — the button warns rather
 * than blocks. An owner who knows their photos are coming later should not
 * be stuck, and an admin reviewing the venue is a better judge of "ready"
 * than a checklist. The one thing that IS enforced is server-side: the
 * venues_prevent_status_escalation trigger means this can only ever reach
 * pending_review, never active.
 */
export function SubmitVenueForReview({ venueId, status, blockingItems }: SubmitVenueForReviewProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  if (status === "active") {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-success/40 bg-success/5 p-4">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">This venue is live</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Players can find and book it on the marketplace.</p>
        </div>
      </div>
    );
  }

  if (status === "pending_review") {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning/5 p-4">
        <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Submitted for review</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AIR/Rally is checking your venue. You&apos;ll get a notification when it&apos;s approved.
          </p>
        </div>
      </div>
    );
  }

  // Suspended venues are an admin decision — an owner resubmitting their
  // way out of one would defeat the point.
  if (status === "suspended") return null;

  async function submit() {
    setSubmitting(true);
    const result = await setVenueStatusAction(venueId, "pending_review");
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Sent for review. We'll let you know once it's approved.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <div>
        <p className="font-medium text-foreground">Ready to go live?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Send this venue to AIR/Rally for approval. Once approved, players can find and book it.
        </p>
      </div>

      {blockingItems.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium text-foreground">Still outstanding</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
            {blockingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            You can still submit — we&apos;ll review what&apos;s here and follow up on the rest.
          </p>
        </div>
      )}

      <Button type="button" onClick={submit} disabled={submitting} className="gap-2 self-start">
        <Send className="size-4" aria-hidden="true" />
        {submitting ? "Sending…" : "Submit for review"}
      </Button>
    </div>
  );
}
