"use client";

import { useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CourtFormDialog } from "@/components/owner/CourtFormDialog";
import { setCourtStatusAction } from "@/lib/actions/court";
import { cn } from "@/lib/utils";
import type { Court, CourtStatus, CourtImage } from "@/lib/supabase/types";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const STATUS_STYLES: Record<CourtStatus, string> = {
  active: "bg-success/15 text-success",
  inactive: "bg-muted text-muted-foreground",
  maintenance: "bg-warning/15 text-warning",
};

const STATUS_LABELS: Record<CourtStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  maintenance: "Maintenance",
};

function CourtRow({ venueId, court, images }: { venueId: string; court: Court; images: CourtImage[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggleStatus() {
    const next: CourtStatus = court.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setCourtStatusAction(venueId, court.id, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(next === "active" ? "Court activated" : "Court deactivated");
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{court.name}</p>
        <p className="text-xs text-muted-foreground">
          {court.indoor_outdoor === "indoor" ? "Indoor" : "Outdoor"} · ₱{court.hourly_price}/hr
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge className={cn("border-transparent", STATUS_STYLES[court.status])}>
          {STATUS_LABELS[court.status]}
        </Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={toggleStatus}
        >
          {court.status === "active" ? "Deactivate" : "Activate"}
        </Button>
        <CourtFormDialog
          venueId={venueId}
          mode="edit"
          court={court}
          images={images}
          trigger={
            <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${court.name}`}>
              <Pencil className="size-4" />
            </Button>
          }
        />
      </div>
    </li>
  );
}

export function CourtsManager({ venueId, courts, images }: { venueId: string; courts: Court[]; images: CourtImage[] }) {
  // Read `courts` directly rather than copying it into useState — every
  // add/edit/status-change flows through a server action + router.refresh(),
  // which re-fetches this prop from the server. Forking it into local state
  // would only capture the initial value and go stale on every refresh.
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Courts</h2>
          <p className="text-sm text-muted-foreground">
            Only active courts are visible to players. Pricing shown here is for display — booking isn&apos;t live yet.
          </p>
        </div>
        <CourtFormDialog
          venueId={venueId}
          mode="create"
          trigger={
            <Button type="button" size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Add Court
            </Button>
          }
        />
      </div>

      {courts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No courts yet. Add your first court to start building your listing.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {courts.map((court) => (
            <CourtRow
              key={court.id}
              venueId={venueId}
              court={court}
              images={images.filter((image) => image.court_id === court.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
