import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CancelBookingButton } from "@/components/court/CancelBookingButton";
import { BookingRefundStatus } from "@/components/court/BookingRefundStatus";
import { RescheduleButton } from "@/components/court/RescheduleButton";
import { ReviewForm } from "@/components/court/ReviewForm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listMyBookingsWithDetails, type BookingWithDetails } from "@/lib/services/bookings";
import { listRefundsForBookings } from "@/lib/services/refunds";
import { listReschedulesForOriginalBookings } from "@/lib/services/reschedules";
import { listReviewableBookings } from "@/lib/services/reviews";
import { RESCHEDULE_CUTOFF_HOURS } from "@/lib/booking-config";
import type { BookingStatus, BookingReschedule } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Real per-viewer bookings — never statically cached.
export const dynamic = "force-dynamic";

export const metadata = { title: "Bookings" };

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-warning/15 text-warning",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
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
        <ul className="mt-8 flex flex-col gap-3">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{booking.venueName}</p>
                    <Badge className={cn("border-transparent", STATUS_STYLES[booking.status])}>{STATUS_LABELS[booking.status]}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {booking.courtName} · {formatWhen(booking)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(booking.price_amount, booking.currency)} · Confirmation {booking.confirmation_code}
                  </p>
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
                    const completed = reschedules.find((r) => r.status === "completed");
                    return completed ? <p className="mt-1 text-xs text-muted-foreground">This booking was rescheduled.</p> : null;
                  })()}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
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
          ))}
        </ul>
      )}
    </div>
  );
}
