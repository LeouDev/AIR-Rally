"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { setVenueStatusAdminAction } from "@/lib/actions/adminVenues";
import type { VenueStatus } from "@/lib/supabase/types";

type AdminVenueStatusActionsProps = {
  venueId: string;
  venueName: string;
  status: VenueStatus;
  /**
   * Total requesters across every unlinked venue_requests candidate
   * matching this venue (see VenueRequestCandidatesPanel). Approving with
   * unlinked candidates still present is exactly how the notification gap
   * happens: notify_on_venue_moderation_change() only fires on THIS
   * transition, and linking afterward notifies no one, ever. A confirm
   * dialog here — the same shape as Suspend's — is the last chance to
   * catch it before it becomes unrecoverable.
   */
  pendingRequestCount?: number;
};

/**
 * Approve/reactivate go straight through when nothing's waiting on them
 * (low-risk, reversible by suspending again). Suspend always gets a
 * confirm dialog — it's the punitive, customer-facing action (the venue
 * disappears from the marketplace) — and so does Approve/Reactivate
 * whenever unlinked venue_requests plausibly match this venue, since that
 * moment is the last chance to link them before the notification trigger
 * fires and moves on. A 'draft' venue has no action here — an owner
 * hasn't submitted it for review yet, so there's nothing for an admin to
 * decide on.
 */
export function AdminVenueStatusActions({ venueId, venueName, status, pendingRequestCount = 0 }: AdminVenueStatusActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function setStatus(next: Extract<VenueStatus, "active" | "suspended">, successMessage: string) {
    startTransition(async () => {
      const result = await setVenueStatusAdminAction(venueId, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setConfirmOpen(false);
      setApproveConfirmOpen(false);
      router.refresh();
    });
  }

  if (status === "pending_review" || status === "suspended" || status === "archived") {
    const label = status === "suspended" ? "Reactivate" : "Approve";
    const successMessage = `${venueName} is now active.`;

    if (pendingRequestCount > 0) {
      return (
        <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="sm">
              {label}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {pendingRequestCount} {pendingRequestCount === 1 ? "player has" : "players have"} asked for this venue
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              They haven&apos;t been linked yet. AIR/Rally only notifies a requester when a venue goes active — not when
              a request is linked afterward. Link them below first, or they will never be notified about this venue.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setApproveConfirmOpen(false)} disabled={isPending}>
                Cancel — let me link them first
              </Button>
              <Button type="button" disabled={isPending} onClick={() => setStatus("active", successMessage)}>
                {isPending ? "Approving…" : `${label} anyway`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Button type="button" size="sm" disabled={isPending} onClick={() => setStatus("active", successMessage)}>
        {isPending ? "Approving…" : label}
      </Button>
    );
  }

  if (status === "active") {
    return (
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" size="sm">
            Suspend
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {venueName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the venue from the marketplace immediately. Existing bookings aren&apos;t affected — only new
            discovery and booking are blocked. The owner can be reactivated at any time.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => setStatus("suspended", `${venueName} has been suspended.`)}>
              {isPending ? "Suspending…" : "Yes, suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
