"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setVenueRequestStatusAction } from "@/lib/actions/venueRequests";
import type { VenueDemandRow as Row } from "@/lib/services/adminVenueRequests";
import { toast } from "sonner";

/**
 * One row of the ranked demand list. The wording is baked in here rather
 * than left to whoever writes the surrounding page: "N players asked for
 * you," never "will book" — a request is a claim, not a commitment, and
 * this is the number the founder will quote directly to a venue owner.
 */
export function VenueDemandRow({ row, siteUrl }: { row: Row; siteUrl: string }) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const name = row.venueName ?? row.placeName ?? "Unnamed venue";
  const city = row.placeCity;

  function setStatus(status: "contacted" | "declined") {
    startTransition(async () => {
      const result = await setVenueRequestStatusAction({ requestId: row.sampleRequestId, status });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(status === "contacted" ? "Marked as contacted." : "Marked as declined.");
    });
  }

  async function copyLink() {
    const url = `${siteUrl}/venues/requests/${row.sampleRequestId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4">
        <div className="font-medium text-foreground">{name}</div>
        {city && <div className="text-sm text-muted-foreground">{city}</div>}
        {row.venueId && (
          <Badge variant="muted" className="mt-1">
            {row.venueStatus}
          </Badge>
        )}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        <span className="text-lg font-semibold text-foreground">{row.requesters}</span>
        <div className="text-xs text-muted-foreground">
          {/* "asked for you" -- never "will book". See this component's own docstring. */}
          {row.requesters === 1 ? "person asked" : "people asked"} for you
        </div>
      </td>
      <td className="py-3 pr-4">
        {row.fullyContacted ? (
          <Badge variant="success">Contacted</Badge>
        ) : (
          <Badge variant="outline">Open</Badge>
        )}
      </td>
      <td className="py-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus("contacted")}>
            Mark contacted
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus("declined")}>
            Decline
          </Button>
        </div>
      </td>
    </tr>
  );
}
