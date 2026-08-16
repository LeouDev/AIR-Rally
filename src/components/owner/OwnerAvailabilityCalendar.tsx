"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, User, Ban, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CourtBlockDialog } from "@/components/owner/CourtBlockDialog";
import { deleteCourtBlockAction } from "@/lib/actions/courtBlock";
import { cn } from "@/lib/utils";
import type { Court } from "@/lib/supabase/types";
import type { OwnerScheduleSlot } from "@/lib/services/ownerAvailability";

const STATUS_STYLES: Record<OwnerScheduleSlot["status"], string> = {
  available: "bg-success/15 text-success",
  booked: "bg-primary/15 text-primary",
  blocked: "bg-warning/15 text-warning",
};

const STATUS_LABELS: Record<OwnerScheduleSlot["status"], string> = {
  available: "Available",
  booked: "Booked",
  blocked: "Blocked",
};

function formatSlotTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
}

function SlotRow({ slot, timezone }: { slot: OwnerScheduleSlot; timezone: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRemoveBlock() {
    if (!slot.blockId) return;
    startTransition(async () => {
      const result = await deleteCourtBlockAction(slot.blockId!);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Block removed");
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-none">
      <span className="w-20 shrink-0 font-medium text-foreground">{formatSlotTime(slot.slotStart, timezone)}</span>
      <Badge className={cn("border-transparent", STATUS_STYLES[slot.status])}>{STATUS_LABELS[slot.status]}</Badge>
      <span className="flex-1 truncate text-muted-foreground">
        {slot.status === "booked" && (
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" aria-hidden="true" />
            {slot.customerName ?? "Customer"} · {slot.bookingStatus}
          </span>
        )}
        {slot.status === "blocked" && (
          <span className="inline-flex items-center gap-1">
            <Wrench className="size-3.5" aria-hidden="true" />
            {slot.blockReason || "Blocked"}
          </span>
        )}
      </span>
      {slot.status === "blocked" && slot.blockId && (
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveBlock} className="gap-1 text-xs">
          <Ban className="size-3.5" aria-hidden="true" />
          Remove
        </Button>
      )}
    </li>
  );
}

function CourtSchedule({ court, slots, timezone, date }: { court: Court; slots: OwnerScheduleSlot[]; timezone: string; date: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{court.name}</h2>
        <CourtBlockDialog courtId={court.id} courtName={court.name} defaultDate={date} />
      </div>
      {slots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Closed all day — no operating hours set for this day of the week.
        </p>
      ) : (
        <ul className="flex flex-col">
          {slots.map((slot) => (
            <SlotRow key={slot.slotStart} slot={slot} timezone={timezone} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnerAvailabilityCalendar({
  venueId,
  date,
  timezone,
  courts,
  schedulesByCourt,
}: {
  venueId: string;
  date: string;
  timezone: string;
  courts: Court[];
  schedulesByCourt: Record<string, OwnerScheduleSlot[]>;
}) {
  const router = useRouter();

  function goToDate(nextDate: string) {
    router.push(`/list-your-court/${venueId}/availability?date=${nextDate}`);
  }

  function shiftDate(days: number) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    goToDate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
          <ChevronLeft className="size-4" />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && goToDate(e.target.value)}
          className="w-auto"
        />
        <Button type="button" variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
          <ChevronRight className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => goToDate(new Date().toISOString().slice(0, 10))}>
          Today
        </Button>
      </div>

      {courts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Add a court first to see its availability here.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {courts.map((court) => (
            <CourtSchedule key={court.id} court={court} slots={schedulesByCourt[court.id] ?? []} timezone={timezone} date={date} />
          ))}
        </div>
      )}
    </div>
  );
}
