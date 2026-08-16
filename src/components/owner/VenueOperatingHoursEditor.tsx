"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { setOperatingHoursAction } from "@/lib/actions/venue";
import type { VenueOperatingHours } from "@/lib/supabase/types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_START = "08:00";
const DEFAULT_END = "20:00";

type DayState = { open: boolean; startTime: string; endTime: string };

function toHHMM(time: string): string {
  // Postgres `time` comes back as "HH:MM:SS" — the native <input type="time"> wants "HH:MM".
  return time.slice(0, 5);
}

function buildInitialState(hours: VenueOperatingHours[]): DayState[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    // Only the first window per day is represented — see
    // lib/validations/venueOperatingHours.ts for why this editor is
    // deliberately one-window-per-day, not a full multi-window UI.
    const existing = hours.find((h) => h.day_of_week === dayOfWeek);
    return existing
      ? { open: true, startTime: toHHMM(existing.start_time), endTime: toHHMM(existing.end_time) }
      : { open: false, startTime: DEFAULT_START, endTime: DEFAULT_END };
  });
}

export function VenueOperatingHoursEditor({ venueId, initialHours }: { venueId: string; initialHours: VenueOperatingHours[] }) {
  const [days, setDays] = useState<DayState[]>(() => buildInitialState(initialHours));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function updateDay(index: number, patch: Partial<DayState>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function save() {
    const invalidDay = days.find((d) => d.open && d.endTime <= d.startTime);
    if (invalidDay) {
      toast.error("End time must be after start time for every open day.");
      return;
    }

    startTransition(async () => {
      const windows = days
        .map((d, dayOfWeek) => ({ dayOfWeek, ...d }))
        .filter((d) => d.open)
        .map((d) => ({ dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime }));

      const result = await setOperatingHoursAction(venueId, { windows });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Operating hours updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Operating hours</CardTitle>
        <CardDescription>
          Days with no hours set show as closed — customers can&apos;t book a time your venue isn&apos;t open.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {days.map((day, index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <label className="flex w-32 shrink-0 items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={day.open}
                onChange={(e) => updateDay(index, { open: e.target.checked })}
                className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              {DAY_LABELS[index]}
            </label>
            {day.open ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="time"
                  value={day.startTime}
                  onChange={(e) => updateDay(index, { startTime: e.target.value })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
                <span>to</span>
                <input
                  type="time"
                  value={day.endTime}
                  onChange={(e) => updateDay(index, { endTime: e.target.value })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        ))}

        <Button type="button" size="lg" className="mt-2 self-start" disabled={isPending} onClick={save}>
          {isPending ? "Saving…" : "Save Hours"}
        </Button>
      </CardContent>
    </Card>
  );
}
