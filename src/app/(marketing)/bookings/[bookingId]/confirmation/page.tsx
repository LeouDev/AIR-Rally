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
      booking = await reconcilePaymongoPendingBooking(createServiceRoleClient(), bookingId);
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

  if (booking.status === "cancelled") {
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

  if (booking.status === "pending") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          icon={Clock}
          title="Your payment is being confirmed"
          description="This usually takes just a few seconds — this page updates by itself. We'll never show a booking as confirmed until payment is actually verified."
          action={
            <div className="flex flex-col items-center gap-3">
              <PendingPaymentAutoRefresh />
              <Button asChild variant="outline">
                <Link href={`/bookings/${booking.id}/confirmation${sessionId ? `?session_id=${sessionId}` : ""}`}>Refresh now</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Booking confirmed!</h1>
          <p className="mt-1 text-sm text-muted-foreground">You&apos;re all set to play.</p>
        </div>

        <dl className="mt-2 grid w-full grid-cols-2 gap-3 rounded-xl border border-border p-4 text-left text-sm">
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
            <dd className="font-medium text-foreground">
              {new Date(booking.start_time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} –{" "}
              {new Date(booking.end_time).toLocaleTimeString("en-US", { timeStyle: "short" })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{completedReschedule ? "Booking total" : "Amount paid"}</dt>
            <dd className="font-medium text-foreground">{formatMoney(booking.price_amount, booking.currency)}</dd>
          </div>
          {completedReschedule && completedReschedule.price_difference !== 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">{completedReschedule.price_difference > 0 ? "Additional payment" : "Refunded"}</dt>
              <dd className="font-medium text-foreground">{formatMoney(Math.abs(completedReschedule.price_difference), booking.currency)}</dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Confirmation code</dt>
            <dd className="font-mono text-base font-semibold tracking-wide text-foreground">{booking.confirmation_code}</dd>
          </div>
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
