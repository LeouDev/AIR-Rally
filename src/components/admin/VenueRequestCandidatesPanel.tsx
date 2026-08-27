"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkVenueRequestsAction } from "@/lib/actions/venueRequests";
import type { VenueRequestCandidate } from "@/lib/services/adminVenueRequests";
import { toast } from "sonner";

/**
 * Surfaced on the venue's own admin page — the moment an admin is about
 * to approve it, not a separate list they'd have to remember to check.
 * Ranked by pg_trgm name similarity: a SUGGESTION, never a match. The
 * admin confirms every link; nothing here writes venue_id on its own.
 */
export function VenueRequestCandidatesPanel({
  venueId,
  venueIsActive,
  candidates,
}: {
  venueId: string;
  venueIsActive: boolean;
  candidates: VenueRequestCandidate[];
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {candidates.length === 1 ? "A player asked for a venue that might be this one" : "Players asked for a venue that might be this one"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Matched by name similarity — a suggestion, not a confirmed match. Check before linking.
          </p>
          {venueIsActive && (
            <p className="mt-2 text-sm font-medium text-destructive">
              This venue is already live. Linking these now will not notify these requesters — the
              notification only fires when a venue goes active, not when a request is linked afterward.
            </p>
          )}
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {candidates.map((c) => (
          <CandidateRow key={`${c.placeName}-${c.placeCity}`} venueId={venueId} candidate={c} />
        ))}
      </ul>
    </div>
  );
}

function CandidateRow({ venueId, candidate }: { venueId: string; candidate: VenueRequestCandidate }) {
  const [isPending, startTransition] = useTransition();
  const [linked, setLinked] = useState(false);
  const router = useRouter();

  function link() {
    startTransition(async () => {
      const result = await linkVenueRequestsAction({ requestIds: candidate.requestIds, venueId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Linked ${result.data.linked} request${result.data.linked === 1 ? "" : "s"}.`);
      setLinked(true);
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
      <div>
        <div className="text-sm font-medium text-foreground">
          {candidate.placeName}
          {candidate.placeCity && <span className="text-muted-foreground"> · {candidate.placeCity}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {candidate.requesters} {candidate.requesters === 1 ? "request" : "requests"} ·{" "}
          {Math.round(candidate.similarity * 100)}% name match
        </div>
      </div>
      <Button size="sm" variant="outline" disabled={isPending || linked} onClick={link}>
        {linked ? "Linked" : isPending ? "Linking…" : "Link to this venue"}
      </Button>
    </li>
  );
}
