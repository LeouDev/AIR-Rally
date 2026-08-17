import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CancelBookingButton } from "@/components/court/CancelBookingButton";
import { BookingRefundStatus } from "@/components/court/BookingRefundStatus";
import { RescheduleButton } from "@/components/court/RescheduleButton";
import { ReviewForm } from "@/components/court/ReviewForm";
import { BookingSections } from "@/components/court/BookingSections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listMyBookingsWithDetails, type BookingWithDetails } from "@/lib/services/bookings";
import { listRefundsForBookings } from "@/lib/services/refunds";
import { listReschedulesForOriginalBookings } from "@/lib/services/reschedules";
import { listReviewableBookings } from "@/lib/services/reviews";
import { RESCHEDULE_CUTOFF_HOURS } from "@/lib/booking-config";
import type { BookingStatus, BookingReschedule } from "@/lib/supabase/types";

// Real per-viewer bookings — never statically cached.
export const dynamic = "force-dynamic";

export const metadata = { title: "Bookings" };

const STATUS_VARIANTS: Record<BookingStatus, "warning" | "success" | "destructive"> = {
  pending: "warning",
  confirmed: "success",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Payment pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

function formatWhen(booking: BookingWithDetails): string {
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const dateStr = new Intl.DateTimeFormat("en-US", { timeZone: booking.venueTimezone, dateStyle: "medium" }).format(start);
  const startStr = new Intl.DateTimeFormat("en-US", { timeZone: booking.venueTimezone, hour: "numeric", minute: "2-digit" }).format(start);
  const endStr = new Intl.DateTimeFormat("en-US", { timeZone: booking.venueTimezone, hour: "numeric", minute: "2-digit" }).format(end);
  return `${dateStr}, ${startStr} – ${endStr}`;
}

function isCancellable(booking: BookingWithDetails): boolean {
  return booking.status !== "cancelled" && new Date(booking.start_time).getTime() > Date.now();
}

/**
 * Buckets this viewer's bookings against a single "now", captured once
 * here so every downstream comparison (which section a booking lands in,
 * and its "starts in" countdown) agrees on the same instant.
 */
function partitionBookings(bookings: BookingWithDetails[]) {
  const now = Date.now();
  return {
    now,
    upcoming: bookings.filter((b) => b.status !== "cancelled" && new Date(b.start_time).getTime() > now),
    completed: bookings.filter((b) => b.status !== "cancelled" && new Date(b.start_time).getTime() <= now),
    cancelled: bookings.filter((b) => b.status === "cancelled"),
  };
}

/**
 * "Starts in ..." for an imminent booking — computed at render time, not
 * a scheduled reminder (this codebase has no scheduler; see ROADMAP).
 * Null beyond 48 hours out, where a countdown stops being useful.
 */
function startsInLabel(startTime: string, now: number): string | null {
  const msUntil = new Date(startTime).getTime() - now;
  if (msUntil <= 0 || msUntil > 48 * 60 * 60_000) return null;
  const hours = Math.floor(msUntil / (60 * 60_000));
  if (hours >= 1) return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.floor(msUntil / 60_000));
  return `Starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * A cheap client-visible pre-filter only — showing/hiding the button. The
 * real eligibility check (no succeeded refund, not itself a replacement,
 * no in-flight reschedule) runs server-side the moment the dialog opens
 * (getRescheduleDialogDataAction), so this never needs to be exhaustive.
 */
function isReschedulable(booking: BookingWithDetails, alreadyRescheduled: boolean): boolean {
  return (
    booking.status === "confirmed" &&
    !alreadyRescheduled &&
    new Date(booking.start_time).getTime() >= Date.now() + RESCHEDULE_CUTOFF_HOURS * 60 * 60_000
  );
}

export default async function BookingsPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const bookings = user ? await listMyBookingsWithDetails(supabase, user.id) : [];
  const refundsByBooking = user ? await listRefundsForBookings(supabase, bookings.map((b) => b.id)) : new Map();
  const reschedulesByBooking = user
    ? await listReschedulesForOriginalBookings(supabase, bookings.map((b) => b.id))
    : new Map<string, BookingReschedule[]>();
  // Maps bookingId -> venueId rather than just a Set<bookingId> — ReviewForm
  // needs the venue id too, and listReviewableBookings() already resolved
  // it server-side, so there's no reason to re-derive it from `booking`.
  const reviewableVenueIdByBookingId = new Map(
    (user ? await listReviewableBookings(supabase, user.id) : []).map((r) => [r.bookingId, r.venueId])
  );

  const { now, upcoming, completed, cancelled } = partitionBookings(bookings);

  function renderBooking(booking: BookingWithDetails) {
    const startsIn = startsInLabel(booking.start_time, now);
    return (
      <li key={booking.id} className="flex flex-col gap-3 rounded-xl bg-card p-3.5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2.5">
            {/* Status first, then the fact that qualifies it. What the booking
                *is* and when it starts are the two things worth reading before
                the venue name. */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANTS[booking.status]} size="status">
                {STATUS_LABELS[booking.status]}
              </Badge>
              {startsIn && <Badge variant="warning">{startsIn}</Badge>}
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[1.0625rem]/[1.375rem] font-semibold text-foreground">{booking.venueName}</p>
              <p className="text-sm/5 text-muted-foreground">{booking.courtName}</p>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-hairline pt-2.5">
              <p className="font-mono text-[0.9375rem]/[1.375rem] font-medium text-foreground">
                {formatWhen(booking)}
              </p>
              <p className="font-mono text-base/[1.375rem] font-semibold text-foreground">
                {formatMoney(booking.price_amount, booking.currency)}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                Code{" "}
                <span className="font-mono tracking-[0.06em] text-foreground">
                  {booking.confirmation_code}
                </span>
              </p>
              <p className="text-xs/4 text-muted-foreground">Venue time (PHT)</p>
            </div>
            {(() => {
              const refunds = refundsByBooking.get(booking.id);
              const latestRefund = refunds?.[0];
              return latestRefund ? (
                <div className="mt-1">
                  <BookingRefundStatus status={latestRefund.status} amount={latestRefund.amount} currency={latestRefund.currency} />
                </div>
              ) : null;
            })()}
            {(() => {
              const reschedules = reschedulesByBooking.get(booking.id) ?? [];
              const completedReschedule = reschedules.find((r) => r.status === "completed");
              return completedReschedule ? <p className="mt-1 text-xs text-muted-foreground">This booking was rescheduled.</p> : null;
            })()}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* A pending booking here means the payment hasn't been
                confirmed back to us yet — normal for a few seconds with
                e-wallets, and the only way out if a webhook is ever
                missed. The confirmation page re-checks the payment
                against PayMongo directly on load, so this link is the
                self-service recovery; without it a paid-but-pending
                booking was a dead end on this page. */}
            {booking.status === "pending" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/bookings/${booking.id}/confirmation`}>Check payment status</Link>
              </Button>
            )}
            {isReschedulable(booking, (reschedulesByBooking.get(booking.id) ?? []).some((r) => r.status === "completed")) && (
              <RescheduleButton bookingId={booking.id} />
            )}
            {isCancellable(booking) && (
              <CancelBookingButton
                bookingId={booking.id}
                venueName={booking.venueName}
                courtName={booking.courtName}
                whenLabel={formatWhen(booking)}
              />
            )}
          </div>
        </div>

        {reviewableVenueIdByBookingId.has(booking.id) && (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-sm font-medium text-foreground">How was your experience?</p>
            <ReviewForm venueId={reviewableVenueIdByBookingId.get(booking.id)!} bookingId={booking.id} />
          </div>
        )}
      </li>
    );
  }

  function renderSection(items: BookingWithDetails[], emptyMessage: string) {
    if (items.length === 0) {
      return <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
    }
    return <ul className="flex flex-col gap-3">{items.map(renderBooking)}</ul>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Your Bookings</h1>
      <p className="mt-1 text-muted-foreground">Reservations you&apos;ve made will show up here.</p>

      {bookings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={CalendarCheck}
            title="No bookings yet"
            description="Once you reserve a court, you'll be able to track upcoming and past sessions here."
            action={
              <Button asChild>
                <Link href="/explore">Find a Court</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <BookingSections
          sections={[
            {
              value: "upcoming",
              label: "Upcoming",
              count: upcoming.length,
              content: renderSection(upcoming, "No upcoming bookings. Find a court to get back on the schedule."),
            },
            {
              value: "completed",
              label: "Completed",
              count: completed.length,
              content: renderSection(completed, "No completed sessions yet."),
            },
            {
              value: "cancelled",
              label: "Cancelled",
              count: cancelled.length,
              content: renderSection(cancelled, "No cancelled bookings."),
            },
          ]}
        />
      )}
    </div>
  );
}
