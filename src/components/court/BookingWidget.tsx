"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { addDays, format, isToday, isTomorrow } from "date-fns";
import { Mail, Phone, Loader2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DatePickerCalendar } from "@/components/shared/DatePickerCalendar";
import { cn } from "@/lib/utils";
import { getAvailableSlotsAction } from "@/lib/actions/availability";
import { createCheckoutSessionAction } from "@/lib/actions/checkout";
import { createOpenPlayForBookingAction } from "@/lib/actions/events";
import { PlayerPicker } from "@/components/court/PlayerPicker";
import type { PublicProfile } from "@/lib/supabase/types";
import { SLOT_INCREMENT_MINUTES, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, MAX_BOOKING_WINDOW_DAYS } from "@/lib/booking-config";
import { calculateBookingCharge } from "@/lib/services/bookingFee";
import { splitBookingPayment } from "@/lib/services/credits";
import type { AvailableSlot, Court } from "@/lib/supabase/types";
import { formatVenueDate, formatVenueTime } from "@/lib/bookingTime";

const VISIBLE_DAYS = 14;

const DURATION_OPTIONS: number[] = [];
for (let m = MIN_DURATION_MINUTES; m <= MAX_DURATION_MINUTES; m += SLOT_INCREMENT_MINUTES) {
  DURATION_OPTIONS.push(m);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
  return `${hours} hr ${mins} min`;
}

function formatDayLabel(date: Date): { top: string; bottom: string } {
  if (isToday(date)) return { top: "Today", bottom: format(date, "MMM d") };
  if (isTomorrow(date)) return { top: "Tomorrow", bottom: format(date, "MMM d") };
  return { top: format(date, "EEE"), bottom: format(date, "MMM d") };
}

type BookingWidgetProps = {
  venueName: string;
  venueTimezone: string;
  courts: Court[];
  phone: string | null;
  email: string | null;
  isAuthenticated: boolean;
  /**
   * Whether PayMongo's processing fee is added to the customer's total.
   * Passed down from the server page because the gate it comes from
   * (PAYMONGO_PASS_ON_FEES_ENABLED) is server-only and deliberately not
   * NEXT_PUBLIC_ — a client-readable kill switch is not a kill switch.
   */
  passOnFees?: boolean;
  /**
   * The viewer's AIR/Rally Credits balance, in minor units, so the confirm
   * dialog can show the credit checkout will actually apply.
   *
   * Without it the dialog quoted the full court price and a fee computed on
   * that price, while checkout applied credit and grossed up the REMAINDER —
   * so a customer holding credit saw a total higher than PayMongo went on to
   * charge them. Observed live: a ₱1200 booking with ₱400 of credit showed
   * ₱1218.27 here and ₱812.18 at PayMongo.
   */
  creditBalance?: number;
};

/**
 * Real booking, replacing Phase 3's display-only CourtsPricingPanel now
 * that Phase 4A/4B make it real. Availability always comes from
 * getAvailableSlotsAction -> get_available_slots() (see
 * lib/services/availability.ts) — never recomputed here. The price shown
 * is the exact court.hourly_price already loaded on this page (public
 * data), so it matches the server-computed snapshot the booking actually
 * gets created with; nothing here is the authoritative amount charged —
 * that's decided server-side in lib/actions/checkout.ts regardless of
 * what this component displays.
 */
export function BookingWidget({ venueName, venueTimezone, courts, phone, email, isAuthenticated, passOnFees = false, creditBalance = 0 }: BookingWidgetProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [selectedCourtId, setSelectedCourtId] = useState(courts[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [durationMinutes, setDurationMinutes] = useState(DURATION_OPTIONS[0] ?? 60);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  // Bumped by refreshSlots() to force a re-fetch of the exact same
  // court/date/duration (e.g. after a booking attempt fails because the
  // slot just became unavailable) without needing any selection to change.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [players, setPlayers] = useState<PublicProfile[]>([]);
  const [isBooking, startBooking] = useTransition();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedCourt = courts.find((c) => c.id === selectedCourtId) ?? null;
  const localDate = format(selectedDate, "yyyy-MM-dd");
  const today = new Date();
  const maxBookableDate = addDays(today, MAX_BOOKING_WINDOW_DAYS);

  // requestKey identifies "the fetch this effect run is for" — comparing
  // it to resolvedKey (set only inside the .then() callback, never
  // synchronously in the effect body) is how `loadingSlots` is derived
  // below, rather than an imperative setState(true)/setState(false) pair
  // at the top/bottom of the effect — the React Compiler's lint flags
  // synchronous setState calls in an effect body as a cascading-render
  // risk; this sidesteps that by never doing one.
  const requestKey = `${selectedCourtId}|${localDate}|${durationMinutes}|${refreshNonce}`;
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const loadingSlots = selectedCourtId !== "" && resolvedKey !== requestKey;

  useEffect(() => {
    if (!selectedCourtId) return;
    let cancelled = false;
    getAvailableSlotsAction({ courtId: selectedCourtId, localDate, durationMinutes }).then((result) => {
      if (cancelled) return;
      setResolvedKey(requestKey);
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
  }, [selectedCourtId, localDate, durationMinutes, refreshNonce, requestKey]);

  function refreshSlots() {
    setRefreshNonce((n) => n + 1);
  }

  function handleSlotClick(slot: AvailableSlot) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    setSelectedSlot(slot);
  }

  function handleConfirmBooking() {
    if (!selectedSlot || !selectedCourtId) return;
    startBooking(async () => {
      const result = await createCheckoutSessionAction({
        courtId: selectedCourtId,
        startTime: selectedSlot.slot_start,
        endTime: selectedSlot.slot_end,
      });
      if (!result.success) {
        toast.error(result.error);
        setSelectedSlot(null);
        refreshSlots();
        return;
      }

      // The roster is set up AFTER the booking exists and BEFORE the
      // redirect. Deliberately non-fatal: a failure here must never block
      // a payment the player has already committed to, so it is reported
      // and the redirect continues regardless.
      if (players.length > 0) {
        const openPlay = await createOpenPlayForBookingAction({
          bookingId: result.data.bookingId,
          playerIds: players.map((p) => p.id),
        });
        if (!openPlay.success) {
          toast.error("Booked, but we couldn't invite your players. You can invite them from the game page.");
        }
      }

      window.location.href = result.data.url;
    });
  }

  if (courts.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
        No courts are currently available to book at this venue.
      </div>
    );
  }

  const estimatedTotal = selectedCourt ? Math.round(selectedCourt.hourly_price * (durationMinutes / 60)) : null;

  // The same gross-up the server will apply, run on the court price in
  // minor units so it agrees with lib/services/bookingFee.ts exactly
  // rather than approximately. Display only — checkout.ts recomputes the
  // authoritative figure server-side, as with every other amount here.
  //
  // Deliberately computed from the FULL court price, while the server
  // grosses up the post-credit amount. This dialog runs before any wallet
  // balance is known, so a customer paying partly in credit sees a fee
  // slightly higher than they are actually charged — the safe direction,
  // and the credits line below tells them why it will shrink.
  // Mirrors what checkout does server-side, in the same order: apply credit
  // first, then gross up only what PayMongo will actually collect. Display
  // only — lib/actions/checkout.ts recomputes the authoritative figures from
  // the real balance and the real price, exactly as before.
  const courtMinorUnits = estimatedTotal !== null ? estimatedTotal * 100 : 0;
  const { creditApplied, amountDue } = splitBookingPayment({
    priceAmount: courtMinorUnits,
    availableCredit: Math.max(0, creditBalance),
  });
  const feeBreakdown = passOnFees && estimatedTotal !== null ? calculateBookingCharge(amountDue) : null;
  const dialogTotal = amountDue + (feeBreakdown?.processingFeeAmount ?? 0);

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Book a court</h3>
        <p className="text-xs text-muted-foreground">Times shown in {venueName}&apos;s local time.</p>
      </div>

      {courts.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="booking-court" className="text-xs font-medium text-muted-foreground uppercase">
            Court
          </label>
          <Select value={selectedCourtId} onValueChange={setSelectedCourtId}>
            <SelectTrigger id="booking-court" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {courts.map((court) => (
                <SelectItem key={court.id} value={court.id}>
                  {court.name} — ₱{court.hourly_price}/hr
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase">Date</p>
        <div className="flex items-stretch gap-1.5">
          <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
            {Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(today, i)).map((date) => {
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
                    active
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <span>{label.top}</span>
                  <span className="text-[11px] text-muted-foreground">{label.bottom}</span>
                </button>
              );
            })}
          </div>

          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Pick a date from the calendar"
                className="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto">
              <DatePickerCalendar
                selected={selectedDate}
                minDate={today}
                maxDate={maxBookableDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setCalendarOpen(false);
                }}
              />
              <p className="px-1 pt-1 text-xs text-muted-foreground">Bookable up to {MAX_BOOKING_WINDOW_DAYS} days ahead.</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="booking-duration" className="text-xs font-medium text-muted-foreground uppercase">
          Duration
        </label>
        <Select value={String(durationMinutes)} onValueChange={(value) => setDurationMinutes(Number(value))}>
          <SelectTrigger id="booking-duration" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {formatDuration(minutes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase">Available times</p>
        {loadingSlots ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking availability…
          </div>
        ) : slotsError ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">
            {slotsError}
          </p>
        ) : slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">
            No available times for this date and duration. Try another date.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => (
              <button
                key={slot.slot_start}
                type="button"
                onClick={() => handleSlotClick(slot)}
                className="rounded-lg border border-border px-2 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {formatVenueTime(slot.slot_start, venueTimezone)}
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={selectedSlot !== null} onOpenChange={(open) => !open && setSelectedSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm your booking</DialogTitle>
          </DialogHeader>
          {selectedSlot && selectedCourt && (
            <div className="flex flex-col gap-3 text-sm">
              <dl className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Venue</dt>
                  <dd className="font-medium text-foreground">{venueName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Court</dt>
                  <dd className="font-medium text-foreground">{selectedCourt.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Date</dt>
                  <dd className="font-medium text-foreground">
                    {formatVenueDate(selectedSlot.slot_start, venueTimezone)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Time</dt>
                  <dd className="font-medium text-foreground">
                    {formatVenueTime(selectedSlot.slot_start, venueTimezone)} – {formatVenueTime(selectedSlot.slot_end, venueTimezone)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium text-foreground">{formatDuration(durationMinutes)}</dd>
                </div>
              </dl>
              {/* Money is mono and right-aligned so the three figures form a
                  column the eye can add up. Only the platform/customer split
                  appears here — the venue/platform revenue split stored on the
                  booking is never customer-facing. */}
              {feeBreakdown ? (
                <div className="flex flex-col gap-2 rounded-lg bg-muted px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm/5 text-subtle">Court ({formatDuration(durationMinutes)})</span>
                    <span className="font-mono text-sm/5 text-foreground">₱{(courtMinorUnits / 100).toFixed(2)}</span>
                  </div>
                  {creditApplied > 0 && (
                    // The line that was missing. Checkout applies this credit
                    // and charges only the remainder, so omitting it quoted a
                    // total the customer was never going to be charged.
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-sm/5 text-subtle">AIR/Rally Credits</span>
                      <span className="font-mono text-sm/5 text-success">−₱{(creditApplied / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-4">
                    {/* "Online payment fee", never "service fee" or "booking
                        fee" — this is PayMongo's charge for collecting the
                        payment, passed through in full. The other labels
                        imply AIR/Rally keeps it. */}
                    <span className="text-sm/5 text-subtle">Online payment fee</span>
                    <span className="font-mono text-sm/5 text-foreground">₱{(feeBreakdown.processingFeeAmount / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
                    <span className="text-[0.9375rem]/5 font-semibold text-foreground">Total</span>
                    <span className="font-mono text-xl/7 font-semibold text-foreground">₱{(dialogTotal / 100).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline justify-between gap-4 rounded-lg bg-muted px-3.5 py-3">
                  <span className="text-[0.9375rem]/5 font-semibold text-foreground">Total</span>
                  <span className="font-mono text-xl/7 font-semibold text-foreground">₱{(dialogTotal / 100).toFixed(2)}</span>
                </div>
              )}

              {feeBreakdown && (
                <p className="text-xs/4 text-muted-foreground">
                  Book with AIR/Rally Credits and this fee doesn&apos;t apply.
                </p>
              )}

              <PlayerPicker
                selected={players}
                onChange={setPlayers}
                totalAmount={(feeBreakdown?.totalChargedAmount ?? (estimatedTotal ?? 0) * 100)}
              />
              <p className="text-xs text-muted-foreground">
                You&apos;ll be redirected to PayMongo to complete payment securely. Your booking is only confirmed once payment succeeds.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={handleConfirmBooking} disabled={isBooking} className="w-full sm:w-auto">
              {isBooking ? "Redirecting to payment…" : "Continue to payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(phone || email) && (
        <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          <p className="text-xs text-muted-foreground">Need more information? Connect with us directly and we&apos;ll assist you.</p>
          {phone && (
            <a href={`tel:${phone}`} className="flex items-center gap-2 text-foreground hover:text-primary">
              <Phone className="size-4 shrink-0" aria-hidden="true" />
              {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className="flex items-center gap-2 text-foreground hover:text-primary">
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              {email}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
