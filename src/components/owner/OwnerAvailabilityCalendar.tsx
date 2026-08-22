"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, User, Ban, Wrench, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CourtBlockDialog } from "@/components/owner/CourtBlockDialog";
import { BookingDetailDialog } from "@/components/owner/BookingDetailDialog";
import { deleteCourtBlockAction } from "@/lib/actions/courtBlock";
import { createClient } from "@/lib/supabase/client";
import { getBookingDetailForOwner, type OwnerBookingWithDetails } from "@/lib/services/ownerBookings";
import { cn } from "@/lib/utils";
import type { Court } from "@/lib/supabase/types";
import { shiftLocalDate, todayInTimezone, type MergedSlot } from "@/lib/services/ownerAvailability";

const CELL_WIDTH = 56;
const ROW_HEADER_WIDTH = 168;

const STATUS_CELL_STYLES: Record<MergedSlot["status"], string> = {
  available: "bg-success/10 hover:bg-success/20",
  booked: "bg-primary/20 text-primary hover:bg-primary/30",
  blocked: "bg-warning/20 text-warning hover:bg-warning/30",
  closed: "bg-muted/70 text-muted-foreground/50",
};

// Mobile agenda uses full-width rows with a text badge (not a tiny
// colored cell), since there's no room for a horizontally-scrolling
// hour grid on a phone and no hover to reveal a tooltip on touch.
const STATUS_BADGE_STYLES: Record<MergedSlot["status"], string> = {
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

const LEGEND: { status: MergedSlot["status"]; label: string; dotClassName: string }[] = [
  { status: "available", label: "Available", dotClassName: "bg-success" },
  { status: "booked", label: "Booked", dotClassName: "bg-primary" },
  { status: "blocked", label: "Blocked", dotClassName: "bg-warning" },
  { status: "closed", label: "Closed", dotClassName: "bg-muted-foreground/40" },
];

/** `slot.localTime` is already a plain "HH:MM" 24-hour string in the
 * venue's own local time — no further timezone conversion needed. */
function formatSlotTime(localTime: string): string {
  const [hourStr, minute] = localTime.split(":");
  const hour = Number(hourStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

/** Compact header label ("6a", "12:30p") — full precision stays in the hover tooltip. */
function formatSlotTimeShort(localTime: string): string {
  const [hourStr, minute] = localTime.split(":");
  const hour = Number(hourStr);
  const period = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${hour12}${period}` : `${hour12}:${minute}${period}`;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {LEGEND.map((item) => (
        <span key={item.status} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", item.dotClassName)} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function BookedCell({ slot, bookingId, onSelectBooking }: { slot: MergedSlot; bookingId: string; onSelectBooking: (bookingId: string) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelectBooking(bookingId)}
          className={cn(
            "flex h-11 cursor-pointer items-center justify-center border-r border-b border-border/40 last:border-r-0",
            STATUS_CELL_STYLES.booked
          )}
        >
          <User className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {formatSlotTime(slot.localTime)} · {slot.customerName ?? "Customer"}
      </TooltipContent>
    </Tooltip>
  );
}

function BlockedCell({ slot, blockId }: { slot: MergedSlot; blockId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRemoveBlock() {
    startTransition(async () => {
      const result = await deleteCourtBlockAction(blockId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Block removed");
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 cursor-pointer items-center justify-center border-r border-b border-border/40 last:border-r-0",
            STATUS_CELL_STYLES.blocked
          )}
        >
          <Wrench className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <p className="text-sm font-medium text-foreground">{formatSlotTime(slot.localTime)}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{slot.blockReason || "Blocked"}</p>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveBlock} className="mt-2 gap-1.5 text-xs">
          <Ban className="size-3.5" aria-hidden="true" />
          Remove block
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function PlainCell({ slot }: { slot: MergedSlot }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex h-11 items-center justify-center border-r border-b border-border/40 last:border-r-0", STATUS_CELL_STYLES[slot.status])}>
          {slot.status === "closed" && <Lock className="size-3" aria-hidden="true" />}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {formatSlotTime(slot.localTime)} · {slot.status === "closed" ? "Outside operating hours" : "Available"}
      </TooltipContent>
    </Tooltip>
  );
}

function SlotCell({ slot, onSelectBooking }: { slot: MergedSlot; onSelectBooking: (bookingId: string) => void }) {
  if (slot.status === "booked" && slot.bookingId) {
    return <BookedCell slot={slot} bookingId={slot.bookingId} onSelectBooking={onSelectBooking} />;
  }
  if (slot.status === "blocked" && slot.blockId) {
    return <BlockedCell slot={slot} blockId={slot.blockId} />;
  }
  return <PlainCell slot={slot} />;
}

/** One court's row — a Fragment, not a wrapping element, so its cells
 * land as direct siblings in the parent CSS grid and line up under the
 * shared time-header columns. */
function CourtRow({
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
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center justify-between gap-2 border-r border-b border-border bg-card px-4 py-2">
        <span className="truncate text-sm font-medium text-foreground">{court.name}</span>
        <CourtBlockDialog courtId={court.id} courtName={court.name} defaultDate={date} iconOnly />
      </div>
      {slots.map((slot) => (
        <SlotCell key={slot.localTime} slot={slot} onSelectBooking={onSelectBooking} />
      ))}
    </>
  );
}

function TimelineGrid({
  courts,
  schedulesByCourt,
  date,
  onSelectBooking,
}: {
  courts: Court[];
  schedulesByCourt: Record<string, MergedSlot[]>;
  date: string;
  onSelectBooking: (bookingId: string) => void;
}) {
  const times = schedulesByCourt[courts[0]?.id]?.map((slot) => slot.localTime) ?? [];

  if (times.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No operating hours configured for this venue yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `${ROW_HEADER_WIDTH}px repeat(${times.length}, ${CELL_WIDTH}px)` }}>
        <div className="sticky top-0 left-0 z-30 border-r border-b border-border bg-card px-4 py-3">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Courts</span>
        </div>
        {times.map((time) => (
          <div
            key={time}
            className="sticky top-0 z-20 flex items-center justify-center border-b border-border bg-card py-3 text-[11px] font-medium text-muted-foreground"
          >
            {formatSlotTimeShort(time)}
          </div>
        ))}

        {courts.map((court) => (
          <CourtRow key={court.id} court={court} slots={schedulesByCourt[court.id] ?? []} date={date} onSelectBooking={onSelectBooking} />
        ))}
      </div>
    </div>
  );
}

function CourtTabs({ courts, selectedId, onSelect }: { courts: Court[]; selectedId: string; onSelect: (courtId: string) => void }) {
  if (courts.length <= 1) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {courts.map((court) => (
        <button
          key={court.id}
          type="button"
          onClick={() => onSelect(court.id)}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            court.id === selectedId
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {court.name}
        </button>
      ))}
    </div>
  );
}

function MobileSlotRow({ slot, onSelectBooking }: { slot: MergedSlot; onSelectBooking: (bookingId: string) => void }) {
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
    <li className="flex items-center gap-3 border-b border-border/60 py-3 last:border-none">
      <span className="w-[4.5rem] shrink-0 text-sm font-medium text-foreground">{formatSlotTime(slot.localTime)}</span>
      <Badge className={cn("shrink-0 border-transparent", STATUS_BADGE_STYLES[slot.status])}>{STATUS_LABELS[slot.status]}</Badge>
      <button
        type="button"
        disabled={!isClickableBooking}
        onClick={() => isClickableBooking && onSelectBooking(slot.bookingId!)}
        className={cn(
          "flex-1 truncate text-left text-sm text-muted-foreground",
          isClickableBooking && "underline-offset-2 hover:text-foreground hover:underline"
        )}
      >
        {slot.status === "booked" && (
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5 shrink-0" aria-hidden="true" />
            {slot.customerName ?? "Customer"}
          </span>
        )}
        {slot.status === "blocked" && (
          <span className="inline-flex items-center gap-1">
            <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
            {slot.blockReason || "Blocked"}
          </span>
        )}
        {slot.status === "closed" && (
          <span className="inline-flex items-center gap-1 text-muted-foreground/70">
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            Outside hours
          </span>
        )}
      </button>
      {slot.status === "blocked" && slot.blockId && (
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveBlock} className="shrink-0 gap-1 text-xs">
          <Ban className="size-3.5" aria-hidden="true" />
          Remove
        </Button>
      )}
    </li>
  );
}

/**
 * Phone-width layout: the hour-grid needs both horizontal scrolling and
 * hover (for status text on available/closed cells) to work, neither of
 * which holds up on a touch screen at 375px wide. This swaps to one
 * court at a time (picked via pills, since courts already stack
 * naturally) and a vertical list of full-width rows that always show
 * their status as text, no hover required.
 */
function MobileAgenda({
  courts,
  schedulesByCourt,
  date,
  onSelectBooking,
}: {
  courts: Court[];
  schedulesByCourt: Record<string, MergedSlot[]>;
  date: string;
  onSelectBooking: (bookingId: string) => void;
}) {
  const [selectedCourtId, setSelectedCourtId] = useState(courts[0]?.id ?? "");
  const selectedCourt = courts.find((c) => c.id === selectedCourtId) ?? courts[0];
  const slots = selectedCourt ? (schedulesByCourt[selectedCourt.id] ?? []) : [];
  const isClosedAllDay = slots.length === 0 || slots.every((slot) => slot.status === "closed");

  if (!selectedCourt) return null;

  return (
    <div className="flex flex-col gap-3">
      <CourtTabs courts={courts} selectedId={selectedCourt.id} onSelect={setSelectedCourtId} />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{selectedCourt.name}</h2>
        <CourtBlockDialog courtId={selectedCourt.id} courtName={selectedCourt.name} defaultDate={date} />
      </div>
      {isClosedAllDay ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Closed all day — no operating hours set for this day of the week.
        </p>
      ) : (
        <ul className="flex flex-col rounded-2xl border border-border bg-card px-4">
          {slots.map((slot) => (
            <MobileSlotRow key={slot.localTime} slot={slot} onSelectBooking={onSelectBooking} />
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
  /** The venue's own IANA zone. Every date this component derives is a
   * venue-local calendar date, never the owner's browser date — an owner
   * can sit in a different zone from the court they are scheduling. */
  timezone: string;
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
    goToDate(shiftLocalDate(date, days));
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && goToDate(e.target.value)} className="w-auto" />
          <Button type="button" variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => goToDate(todayInTimezone(timezone))}>
            Today
          </Button>
        </div>
        <Legend />
      </div>

      {courts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Add a court first to see its availability here.
        </p>
      ) : (
        <>
          <div className="sm:hidden">
            <MobileAgenda courts={courts} schedulesByCourt={schedulesByCourt} date={date} onSelectBooking={handleSelectBooking} />
          </div>
          <div className="hidden sm:block">
            <TimelineGrid courts={courts} schedulesByCourt={schedulesByCourt} date={date} onSelectBooking={handleSelectBooking} />
          </div>
        </>
      )}

      <BookingDetailDialog booking={selectedBooking} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
