"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, MapPin, Building2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteVenueAction } from "@/lib/actions/venue";
import type { OwnerVenueSummary } from "@/lib/services/venues";
import type { VenueStatus } from "@/lib/supabase/types";

const STATUS_STYLES: Record<VenueStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-warning/15 text-warning",
  active: "bg-success/15 text-success",
  suspended: "bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<VenueStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  active: "Active",
  suspended: "Suspended",
};

export function OwnerVenueCard({ venue }: { venue: OwnerVenueSummary }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteVenueAction(venue.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Venue deleted");
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40">
      <Link href={`/list-your-court/${venue.id}`} className="flex flex-col focus-visible:outline-none">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
          {venue.coverImageUrl ? (
            <Image
              src={venue.coverImageUrl}
              alt={venue.name}
              fill
              sizes="(min-width: 1024px) 360px, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Building2 className="size-8 text-muted-foreground/50" aria-hidden="true" />
            </div>
          )}
          <Badge className={cn("absolute left-3 top-3 border-transparent", STATUS_STYLES[venue.status])}>
            {STATUS_LABELS[venue.status]}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{venue.name}</p>
            {venue.city && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{venue.city}</span>
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {venue.courtCount} {venue.courtCount === 1 ? "court" : "courts"}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </Link>

      {/* Draft-only: mirrors the venues DELETE RLS policy exactly (owner's
          own draft venues, or admin — see
          supabase/migrations/20260809000002_venues.sql). Hiding the
          control for other statuses is a UX nicety, not the security
          boundary — RLS is. */}
      {venue.status === "draft" && (
        <div className="border-t border-border px-4 py-2">
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete draft
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this draft venue?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This permanently deletes &ldquo;{venue.name}&rdquo; and any courts or photos you&apos;ve added to
                it. This can&apos;t be undone.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
                  {isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
