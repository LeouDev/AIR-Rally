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
};

/**
 * Approve/reactivate go straight through (low-risk, reversible by
 * suspending again). Suspend gets a confirm dialog — it's the punitive,
 * customer-facing action (the venue disappears from the marketplace).
 * A 'draft' venue has no action here — an owner hasn't submitted it for
 * review yet, so there's nothing for an admin to decide on.
 */
export function AdminVenueStatusActions({ venueId, venueName, status }: AdminVenueStatusActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      router.refresh();
    });
  }

  if (status === "pending_review" || status === "suspended" || status === "archived") {
    return (
      <Button type="button" size="sm" disabled={isPending} onClick={() => setStatus("active", `${venueName} is now active.`)}>
        {isPending ? "Approving…" : status === "suspended" ? "Reactivate" : "Approve"}
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
