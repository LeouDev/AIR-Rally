"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isToday, isTomorrow } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getAvailableSlotsAction } from "@/lib/actions/availability";
import { getRescheduleDialogDataAction, createRescheduleAction } from "@/lib/actions/reschedule";
import type { AvailableSlot } from "@/lib/supabase/types";
import type { RescheduleOptions } from "@/lib/services/reschedules";
import { formatVenueTime } from "@/lib/bookingTime";

const VISIBLE_DAYS = 14;

function formatDayLabel(date: Date): { top: string; bottom: string } {
  if (isToday(date)) return { top: "Today", bottom: format(date, "MMM d") };
  if (isTomorrow(date)) return { top: "Tomorrow", bottom: format(date, "MMM d") };
  return { top: format(date, "EEE"), bottom: format(date, "MMM d") };
}

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

type RescheduleButtonProps = {
  bookingId: string;
};

/**
 * V1 rescheduling: date + court may change, duration and venue may not
 * (see lib/services/reschedules.ts). Every real decision — eligibility,
 * the actual price difference, whether a payment/refund is needed — is
 * re-verified server-side by createRescheduleAction; everything computed
 * here is a display-only preview, same posture BookingWidget already
 * established for its own price estimate.
 */
export function RescheduleButton({ bookingId }: RescheduleButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ineligibleMessage, setIneligibleMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<RescheduleOptions | null>(null);

  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [isSubmitting, startSubmitting] = useTransition();

  // Same requestKey/resolvedKey pattern BookingWidget uses: "loading" is
  // derived by comparing keys, rather than a synchronous setState(true)
  // at the top of the effect body (flagged by react-hooks/set-state-in-effect
  // as a cascading-render risk).
  const dialogRequestKey = open ? bookingId : null;
  const [dialogResolvedKey, setDialogResolvedKey] = useState<string | null>(null);
  const loadingOptions = dialogRequestKey !== null && dialogResolvedKey !== dialogRequestKey;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getRescheduleDialogDataAction(bookingId).then((result) => {
      if (cancelled) return;
      setDialogResolvedKey(dialogRequestKey);
      if (!result.success) {
        setIneligibleMessage(result.error);
        setOptions(null);
        return;
      }
      if (!result.data.eligible || !result.data.options) {
        setIneligibleMessage(result.data.message ?? "This booking can't be rescheduled right now.");
        setOptions(null);
        return;
      }
      setIneligibleMessage(null);
      setOptions(result.data.options);
      setSelectedCourtId(result.data.options.courts[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, bookingId, dialogRequestKey]);

  const selectedCourt = options?.courts.find((c) => c.id === selectedCourtId) ?? null;
  const localDate = format(selectedDate, "yyyy-MM-dd");

  const slotsRequestKey = open && options && selectedCourtId ? `${selectedCourtId}|${localDate}` : null;
  const [slotsResolvedKey, setSlotsResolvedKey] = useState<string | null>(null);
  const loadingSlots = slotsRequestKey !== null && slotsResolvedKey !== slotsRequestKey;

  useEffect(() => {
    if (!open || !options || !selectedCourtId) return;
    let cancelled = false;
    getAvailableSlotsAction({ courtId: selectedCourtId, localDate, durationMinutes: options.originalDurationMinutes }).then((result) => {
      if (cancelled) return;
      setSlotsResolvedKey(slotsRequestKey);
      if (!result.success) {
        setSlotsError(result.error);
        setSlots([]);
        return;
      }
      setSlotsError(null);
      setSlots(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, options, selectedCourtId, localDate, slotsRequestKey]);

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedSlot(null);
      setSlots([]);
    }
  }

  function handleConfirm() {
    if (!selectedSlot || !selectedCourtId) return;
    startSubmitting(async () => {
      const result = await createRescheduleAction({
        bookingId,
        newCourtId: selectedCourtId,
        newStartTime: selectedSlot.slot_start,
        newEndTime: selectedSlot.slot_end,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.data.kind === "checkout_required") {
        window.location.href = result.data.checkoutUrl;
        return;
      }
      if (result.data.kind === "provider_unavailable") {
        toast.error("This reschedule needs manual handling for the refund — your original booking is unchanged. Contact support.");
        handleClose(false);
        router.refresh();
        return;
      }
      toast.success("Booking rescheduled");
      handleClose(false);
      router.refresh();
    });
  }

  const estimatedNewPrice = selectedCourt && options ? Math.round(selectedCourt.hourly_price * 100 * (options.originalDurationMinutes / 60)) : null;
  const estimatedDifference = estimatedNewPrice != null && options ? estimatedNewPrice - options.originalPriceAmount : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reschedule this booking</DialogTitle>
        </DialogHeader>

        {loadingOptions ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking eligibility…
          </div>
        ) : ineligibleMessage ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">{ineligibleMessage}</p>
        ) : options ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              You can pick a different date and court at {options.venueName} — the venue and session length stay the same. A booking may
              only be rescheduled once.
            </p>

            {options.courts.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reschedule-court" className="text-xs font-medium text-muted-foreground uppercase">
                  Court
                </label>
                <Select value={selectedCourtId} onValueChange={setSelectedCourtId}>
                  <SelectTrigger id="reschedule-court" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.courts.map((court) => (
                      <SelectItem key={court.id} value={court.id}>
                        {court.name} — ₱{court.hourly_price}/hr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase">New date</p>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(new Date(), i)).map((date) => {
                  const label = formatDayLabel(date);
                  const active = format(date, "yyyy-MM-dd") === localDate;
                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedDate(date)}
                      className={cn(
                        "flex shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        active ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      <span>{label.top}</span>
                      <span className="text-[11px] text-muted-foreground">{label.bottom}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase">Available times</p>
              {loadingSlots ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Checking availability…
                </div>
              ) : slotsError ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">
                  No available times for this date. Try another date.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot.slot_start}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        selectedSlot?.slot_start === slot.slot_start
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-foreground hover:border-primary/40"
                      )}
                    >
                      {formatVenueTime(slot.slot_start, options.venueTimezone)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSlot && estimatedDifference != null && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Original price</span>
                  <span className="font-medium text-foreground">{formatMoney(options.originalPriceAmount, options.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New price</span>
                  <span className="font-medium text-foreground">{formatMoney(estimatedNewPrice ?? 0, options.currency)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-medium text-foreground">
                    {estimatedDifference > 0 ? "You'll pay" : estimatedDifference < 0 ? "You'll be refunded" : "No change"}
                  </span>
                  <span className="font-semibold text-foreground">{formatMoney(Math.abs(estimatedDifference), options.currency)}</span>
                </div>
                {estimatedDifference > 0 && (
                  <p className="text-xs text-muted-foreground">You&apos;ll be redirected to pay just the difference — your original payment isn&apos;t touched.</p>
                )}
                {estimatedDifference < 0 && (
                  <p className="text-xs text-muted-foreground">Only the price difference is refunded — any payment processing fee isn&apos;t refunded.</p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {options && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!selectedSlot || isSubmitting}>
              {isSubmitting ? "Rescheduling…" : "Confirm reschedule"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
