"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setVenueAmenitiesAction } from "@/lib/actions/venue";
import type { Amenity } from "@/lib/supabase/types";

export function VenueAmenitiesEditor({
  venueId,
  allAmenities,
  initialSelectedIds,
}: {
  venueId: string;
  allAmenities: Amenity[];
  initialSelectedIds: string[];
}) {
  const [selectedIds, setSelectedIds] = useState(new Set(initialSelectedIds));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const isDirty =
    selectedIds.size !== initialSelectedIds.length ||
    initialSelectedIds.some((id) => !selectedIds.has(id));

  function toggle(amenityId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(amenityId)) next.delete(amenityId);
      else next.add(amenityId);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setVenueAmenitiesAction(venueId, { amenityIds: Array.from(selectedIds) });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Amenities updated");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Amenities</h2>
        <p className="text-sm text-muted-foreground">Select everything your venue offers.</p>
      </div>

      {allAmenities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No amenities are configured yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allAmenities.map((amenity) => {
            const selected = selectedIds.has(amenity.id);
            return (
              <button
                key={amenity.id}
                type="button"
                onClick={() => toggle(amenity.id)}
                aria-pressed={selected}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/40"
                )}
              >
                {amenity.name}
              </button>
            );
          })}
        </div>
      )}

      <Button type="button" size="lg" className="self-start" disabled={!isDirty || isPending} onClick={save}>
        {isPending ? "Saving…" : "Save Changes"}
      </Button>
    </div>
  );
}
