import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PendingPaymentAutoRefresh } from "@/components/court/PendingPaymentAutoRefresh";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getBookingById, reconcilePaymongoPendingBooking } from "@/lib/services/bookings";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { calculateAmountPaid } from "@/lib/services/bookingFee";
import { formatVenueRange } from "@/lib/bookingTime";
import { derivePaymentState, isCreditOnly } from "@/lib/paymentState";
import { maybeCompleteRescheduleFromProvider, listReschedulesForBooking } from "@/lib/services/reschedules";
import { logServerError } from "@/lib/errors";

// Real per-viewer booking state, possibly reconciled against PayMongo on
// every load (see the pending branch below) — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking Confirmation" };

type ConfirmationPageProps = {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ session_id?: string; cancelled?: string }>;
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

/**
 * Always the VENUE's local time, matching every other screen.
 *
 * This page once formatted with no timeZone at all, which on the server means
 * UTC — a 5:00 PM Manila booking printed "9:00 AM" on the customer's own
 * confirmation. formatVenueRange REQUIRES a timezone, so that failure cannot
 * recur silently; when the venue lookup failed there is no timezone to render
 * against, and the honest answer is a dash rather than a time in the wrong
 * zone.
 */
function formatWhen(startIso: string, endIso: string, timeZone: string | undefined): string {
  if (!timeZone) return "—";
  return formatVenueRange(startIso, endIso, timeZone);
}

export default async function BookingConfirmationPage({ params, searchParams }: ConfirmationPageProps) {
  const { bookingId } = await params;
  const { session_id: sessionId, cancelled } = await searchParams;

  const user = await getCurrentUser();
  if (!user) notFound(); // proxy.ts already redirects unauthenticated requests away from /bookings/*; this is just defense in depth.

  const supabase = await createClient();

  let booking = await getBookingById(supabase, bookingId);
  // Own-booking check is stricter than what RLS alone permits here —
  // RLS also lets a venue owner see bookings at their own courts (a
  // deliberate Phase 4A allowance for a future owner dashboard), but
  // *this* page is specifically "my own receipt," so it must never
  // render as if it were for someone else's booking even if RLS would
  // technically let the row through.
  if (!booking || booking.user_id !== user.id) notFound();

  // Whether PayMongo shows a payment attempt that hasn't resolved yet —
  // the signal that tells derivePaymentState() to say "processing"
  // instead of "book again" below. Only ever set by the reconcile call.
  let paymentInFlight = false;

  // Redirect arrives before webhook: reconcile with the real payment
  // provider directly rather than showing a false "still pending" state
  // the user would have to guess needs a manual refresh for no reason.
  // PayMongo is the only provider, and it needs no ?session_id= from the
  // URL — that id is already on the booking row itself.
  if (booking.status === "pending") {
    try {
      // Service role, because confirm_paymongo_booking_payment() is
      // granted to service_role only since migration 20260810000047.
      // Two things make that safe here, and both must stay true: the
      // `booking.user_id !== user.id` check above has already run, so
      // this only ever reconciles the viewer's own booking; and
      // reconcilePaymongoPendingBooking() retrieves the session from
      // PayMongo and requires a payment with status 'paid' before it
      // confirms anything. Rendering the page still uses the RLS-scoped
      // client — only the verified confirmation is privileged.
      const reconciled = await reconcilePaymongoPendingBooking(createServiceRoleClient(), bookingId);
      booking = reconciled.booking;
      paymentInFlight = reconciled.paymentInFlight;
    } catch (error) {
      logServerError("bookings.confirmation.reconcile", error);
      // Reconciliation failing doesn't change what we show — the page
      // still renders the current (still-pending) state honestly below.
    }

    // Additive: the reconcile calls above check this booking's own
    // price_amount against what was actually paid — which never matches
    // for a reschedule's price-increase difference checkout (see
    // lib/services/reschedules.ts), so they always no-op for it. This is
    // the real "redirect arrives before webhook" fallback for that case;
    // for every normal booking it's a cheap no-op (no booking_reschedules
    // row references it).
    if (booking.status === "pending") {
      try {
        const completed = await maybeCompleteRescheduleFromProvider(supabase, bookingId);
        if (completed) {
          booking = (await getBookingById(supabase, bookingId)) ?? booking;
        }
      } catch (error) {
        logServerError("bookings.confirmation.rescheduleReconcile", error);
      }
    }
  }

  const display = await getCourtDisplayInfo(supabase, booking.court_id);

  // Only relevant once the booking is actually confirmed — a booking
  // that came from a completed reschedule had its own checkout (if any)
  // charge just the price DIFFERENCE, never this booking's full
  // price_amount, so "Amount paid" would misrepresent what this specific
  // transaction actually charged/refunded. Ordinary (non-reschedule)
  // bookings are completely unaffected: `completedReschedule` stays
  // null for them and the existing "Amount paid" wording is untouched.
  const completedReschedule =
    booking.status === "confirmed"
      ? (await listReschedulesForBooking(supabase, booking.id)).find((r) => r.new_booking_id === booking.id && r.status === "completed")
      : undefined;

  const paymentState = derivePaymentState(booking, { paymentInFlight });
  const creditOnly = isCreditOnly(booking);

  if (paymentState === "cancelled") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          icon={CalendarClock}
          title={cancelled ? "Checkout was cancelled" : "This booking was cancelled"}
          description={
            cancelled
              ? "No payment was made and this time slot has been released. You can try booking again whenever you're ready."
              : "This booking is no longer active."
          }
          action={
            <Button asChild>
              <Link href="/explore">Browse Courts</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Money is in flight and the webhook has not landed. Seconds, and it
  // resolves itself — so the page waits on the customer's behalf.
  if (paymentState === "settling") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          icon={Clock}
          title="Your payment is being confirmed"
          description={
            creditOnly
              ? "Applying your AIR/Rally Credits — this page updates by itself. We'll never show a booking as confirmed until payment is actually verified."
              : "E-wallets sometimes take a few seconds to report back. This page updates by itself, and we'll never show a booking as confirmed until payment is actually verified."
          }
          action={
            <div className="flex flex-col items-center gap-3">
              <PendingPaymentAutoRefresh />
              <Button asChild variant="outline">
                <Link href={`/bookings/${booking.id}/confirmation${sessionId ? `?session_id=${sessionId}` : ""}`}>Refresh now</Link>
              </Button>
            </div>
          }
        />
        <p className="mt-4 text-center text-[0.8125rem]/[1.125rem] text-muted-foreground text-pretty">
          Your slot stays held while this is pending. If the payment fails, the slot is
          released and nothing is charged. You can always find this in Bookings, marked Pending.
        </p>
      </div>
    );
  }

  // Nothing was ever charged: checkout was opened and left. Waiting cannot fix
  // this, so the page must not ask the customer to wait — it has to hand them
  // a way back in. This is the state every pending booking in production is
  // actually in.
  if (paymentState === "awaiting_payment") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          icon={CalendarClock}
          title="This booking hasn't been paid yet"
          description="Checkout was started but never completed, so nothing was charged and this slot isn't held. You can book the same time again if it's still free."
          action={
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <Button asChild>
                <Link href={display ? `/courts/${display.venueId}` : "/explore"}>
                  Book this court again
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/bookings">Go to Bookings</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Built to be screenshotted. The code is the largest object on the
          card and sits above the venue and time, because at the gate it is
          the only thing anyone reads — and nothing here depends on still
          being signed in to make sense. */}
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card p-8 text-center shadow-card">
        <div className="flex size-14 animate-pop items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl/[1.875rem] font-semibold tracking-[-0.01em] text-foreground">
            You&apos;re on court.
          </h1>
          <p className="mt-1 text-[0.9375rem]/[1.375rem] text-subtle">
            {creditOnly ? "Paid with AIR/Rally Credits." : "Paid in full."} Show this code at the venue.
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-1 rounded-lg bg-muted px-4 py-5">
          <span className="text-[0.6875rem]/[0.875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Confirmation code
          </span>
          <span className="font-mono text-3xl/9 font-semibold tracking-[0.08em] text-foreground">
            {booking.confirmation_code}
          </span>
        </div>

        <dl className="grid w-full grid-cols-2 gap-3 rounded-lg border border-hairline p-4 text-left text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Venue</dt>
            <dd className="font-medium text-foreground">{display?.venueName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Court</dt>
            <dd className="font-medium text-foreground">{display?.courtName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Date &amp; time</dt>
            <dd className="font-mono font-medium text-foreground">{formatWhen(booking.start_time, booking.end_time, display?.venueTimezone)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{completedReschedule ? "Booking total" : "Amount paid"}</dt>
            <dd className="font-mono font-semibold text-foreground">{formatMoney(calculateAmountPaid(booking), booking.currency)}</dd>
          </div>
          {completedReschedule && completedReschedule.price_difference !== 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">{completedReschedule.price_difference > 0 ? "Additional payment" : "Refunded"}</dt>
              <dd className="font-mono font-semibold text-foreground">{formatMoney(Math.abs(completedReschedule.price_difference), booking.currency)}</dd>
            </div>
          )}
        </dl>

        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild className="flex-1">
            <Link href="/bookings">View My Bookings</Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/explore">Explore More Courts</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
