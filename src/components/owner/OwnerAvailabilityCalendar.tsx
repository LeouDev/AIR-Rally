"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, User, Ban, Wrench, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CourtBlockDialog } from "@/components/owner/CourtBlockDialog";
import { BookingDetailDialog } from "@/components/owner/BookingDetailDialog";
import { deleteCourtBlockAction } from "@/lib/actions/courtBlock";
import { createClient } from "@/lib/supabase/client";
import { getBookingDetailForOwner, type OwnerBookingWithDetails } from "@/lib/services/ownerBookings";
import { cn } from "@/lib/utils";
import type { Court } from "@/lib/supabase/types";
import type { MergedSlot } from "@/lib/services/ownerAvailability";

const STATUS_STYLES: Record<MergedSlot["status"], string> = {
  available: "bg-success/15 text-success",
  booked: "bg-primary/15 text-primary",
  blocked: "bg-warning/15 text-warning",
  closed: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<MergedSlot["status"], string> = {
  available: "Available",
  booked: "Booked",
  blocked: "Blocked",
  closed: "Closed",
};

/** `slot.localTime` is already a plain "HH:MM" 24-hour string in the
 * venue's own local time — no further timezone conversion needed. */
function formatSlotTime(localTime: string): string {
  const [hourStr, minute] = localTime.split(":");
  const hour = Number(hourStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

function SlotRow({ slot, onSelectBooking }: { slot: MergedSlot; onSelectBooking: (bookingId: string) => void }) {
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

  const isClickableBooking = slot.status === "booked" && !!slot.bookingId;

  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-none">
      <span className="w-20 shrink-0 font-medium text-foreground">{formatSlotTime(slot.localTime)}</span>
      <Badge className={cn("border-transparent", STATUS_STYLES[slot.status])}>{STATUS_LABELS[slot.status]}</Badge>
      <button
        type="button"
        disabled={!isClickableBooking}
        onClick={() => isClickableBooking && onSelectBooking(slot.bookingId!)}
        className={cn(
          "flex-1 truncate text-left text-muted-foreground",
          isClickableBooking && "cursor-pointer underline-offset-2 hover:text-foreground hover:underline"
        )}
      >
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
        {slot.status === "closed" && (
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3.5" aria-hidden="true" />
            Outside operating hours
          </span>
        )}
      </button>
      {slot.status === "blocked" && slot.blockId && (
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveBlock} className="gap-1 text-xs">
          <Ban className="size-3.5" aria-hidden="true" />
          Remove
        </Button>
      )}
    </li>
  );
}

function CourtSchedule({
  court,
  slots,
  date,
  onSelectBooking,
}: {
  court: Court;
  slots: MergedSlot[];
  date: string;
  onSelectBooking: (bookingId: string) => void;
}) {
  const isClosedAllDay = slots.length === 0 || slots.every((slot) => slot.status === "closed");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{court.name}</h2>
        <CourtBlockDialog courtId={court.id} courtName={court.name} defaultDate={date} />
      </div>
      {isClosedAllDay ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Closed all day — no operating hours set for this day of the week.
        </p>
      ) : (
        <ul className="flex flex-col">
          {slots.map((slot) => (
            <SlotRow key={slot.localTime} slot={slot} onSelectBooking={onSelectBooking} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnerAvailabilityCalendar({
  venueId,
  date,
  courts,
  schedulesByCourt,
}: {
  venueId: string;
  date: string;
  courts: Court[];
  schedulesByCourt: Record<string, MergedSlot[]>;
}) {
  const router = useRouter();
  const [selectedBooking, setSelectedBooking] = useState<OwnerBookingWithDetails | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function goToDate(nextDate: string) {
    router.push(`/list-your-court/${venueId}/availability?date=${nextDate}`);
  }

  function shiftDate(days: number) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    goToDate(d.toISOString().slice(0, 10));
  }

  async function handleSelectBooking(bookingId: string) {
    setDialogOpen(true);
    setSelectedBooking(null);
    const supabase = createClient();
    const booking = await getBookingDetailForOwner(supabase, bookingId);
    if (!booking) {
      toast.error("Couldn't load booking details");
      setDialogOpen(false);
      return;
    }
    setSelectedBooking(booking);
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
            <CourtSchedule
              key={court.id}
              court={court}
              slots={schedulesByCourt[court.id] ?? []}
              date={date}
              onSelectBooking={handleSelectBooking}
            />
          ))}
        </div>
      )}

      <BookingDetailDialog booking={selectedBooking} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
