"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkVenueRequestsAction } from "@/lib/actions/venueRequests";
import type { UnlinkedRequestRow, MergeTargetVenue } from "@/lib/services/adminVenueRequests";
import { toast } from "sonner";

/**
 * Surfaced ABOVE the main demand list, not buried below it — deliberately.
 * Every row here is a request that gets NO notification when a venue lists,
 * because nothing links it to a real venue row. That failure is invisible
 * from the rest of the admin view: a venue goes live, everyone linked is
 * told, and nothing here suggests anyone was missed.
 */
export function UnlinkedVenueRequestRow({
  row,
  targets,
}: {
  row: UnlinkedRequestRow;
  targets: MergeTargetVenue[];
}) {
  const [isPending, startTransition] = useTransition();
  const [venueId, setVenueId] = useState("");

  function merge() {
    if (!venueId) return;
    startTransition(async () => {
      const result = await linkVenueRequestsAction({ requestIds: row.requestIds, venueId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Linked ${result.data.linked} request${result.data.linked === 1 ? "" : "s"}.`);
      setVenueId("");
    });
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
          {row.placeName}
        </div>
        {row.placeCity && <div className="text-sm text-muted-foreground">{row.placeCity}</div>}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-foreground">{row.requesters}</td>
      <td className="py-3">
        {targets.length === 0 ? (
          <span className="text-sm text-muted-foreground">No venue is currently onboarding.</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="h-9 rounded-lg border-[1.5px] border-input bg-card px-2 text-sm"
            >
              <option value="">Link to venue…</option>
              {targets.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.city ? ` — ${v.city}` : ""}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!venueId || isPending} onClick={merge}>
              Link
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
