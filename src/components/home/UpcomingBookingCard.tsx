import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatVenueRange } from "@/lib/bookingTime";
import type { BookingWithDetails } from "@/lib/services/bookings";

/**
 * The next game, at the top of Home.
 *
 * For someone who has already booked, this is why they opened the app — to
 * re-check the time, or to show the confirmation code at the gate. Making
 * them find it under a search field and a carousel gets the order backwards.
 *
 * A `pending` booking links to the confirmation page rather than the booking
 * itself: that page re-checks the payment against PayMongo on load, so a
 * payment whose webhook never arrived always has a way forward from here.
 */
export function UpcomingBookingCard({ booking }: { booking: BookingWithDetails }) {
  const isPending = booking.status === "pending";
  const href = isPending ? `/bookings/${booking.id}/confirmation` : "/bookings";

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-xs/4 font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Your next game
      </h2>

      <Link
        href={href}
        className="group flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPending ? "warning" : "success"} size="status">
            {isPending ? "Payment pending" : "Confirmed"}
          </Badge>
          {isPending && <Badge variant="neutral">Check payment status</Badge>}
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="text-[1.0625rem]/[1.375rem] font-semibold text-foreground">{booking.venueName}</p>
          <p className="text-sm/5 text-muted-foreground">{booking.courtName}</p>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-hairline pt-3">
          <p className="font-mono text-[0.9375rem]/[1.375rem] font-medium text-foreground">
            {formatVenueRange(booking.start_time, booking.end_time, booking.venueTimezone)}
          </p>
          <p className="text-xs/4 text-muted-foreground">Venue time (PHT)</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
            Code{" "}
            <span className="font-mono tracking-[0.06em] text-foreground">{booking.confirmation_code}</span>
          </p>
          <span className="inline-flex items-center gap-1 text-sm/5 font-semibold text-primary">
            {isPending ? "Check status" : "View booking"}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </section>
  );
}
