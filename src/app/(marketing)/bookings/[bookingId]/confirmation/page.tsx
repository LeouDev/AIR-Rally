import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getBookingById, reconcilePendingBooking, reconcilePaymongoPendingBooking } from "@/lib/services/bookings";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { logServerError } from "@/lib/errors";

// Real per-viewer booking state, possibly reconciled against Stripe on
// every load (see the pending-with-session_id branch below) — never
// statically cached.
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
  // Branches on the booking's own stored provider (see ARCHITECTURE.md's
  // PayMongo TEST MODE section) — the PayMongo path needs no ?session_id=
  // from the URL, since that id is already on the booking row itself.
  if (booking.status === "pending") {
    try {
      if (booking.payment_provider === "paymongo") {
        booking = await reconcilePaymongoPendingBooking(supabase, bookingId);
      } else if (sessionId) {
        booking = await reconcilePendingBooking(supabase, bookingId, sessionId);
      }
    } catch (error) {
      logServerError("bookings.confirmation.reconcile", error);
      // Reconciliation failing doesn't change what we show — the page
      // still renders the current (still-pending) state honestly below.
    }
  }

  const display = await getCourtDisplayInfo(supabase, booking.court_id);

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
          description="This usually takes just a few seconds. Refresh this page to check again — we'll never show a booking as confirmed until payment is actually verified."
          action={
            <Button asChild variant="outline">
              <Link href={`/bookings/${booking.id}/confirmation${sessionId ? `?session_id=${sessionId}` : ""}`}>Refresh</Link>
            </Button>
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
            <dt className="text-xs text-muted-foreground">Amount paid</dt>
            <dd className="font-medium text-foreground">{formatMoney(booking.price_amount, booking.currency)}</dd>
          </div>
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
