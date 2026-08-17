"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BookingWidget } from "@/components/court/BookingWidget";
import type { Court } from "@/lib/supabase/types";
import { BOOKING_BAR_VISIBILITY } from "@/lib/bookingBreakpoint";

type MobileBookingBarProps = {
  startingPrice: number | null;
  venueName: string;
  venueTimezone: string;
  courts: Court[];
  phone: string | null;
  email: string | null;
  isAuthenticated: boolean;
  /** Forwarded verbatim to the BookingWidget in the sheet — see its props. */
  passOnFees?: boolean;
  /** Forwarded to the BookingWidget so the confirm dialog can show applied credit. */
  creditBalance?: number;
};

/**
 * Airbnb-style persistent price + CTA bar. Tapping "Book a court" pops
 * the exact same BookingWidget up as a bottom sheet rather than the page
 * carrying a second always-visible copy of it inline.
 *
 * Hidden at `lg` and up, which is exactly where the sidebar BookingWidget
 * takes over (it is `hidden lg:block` on the court page). These two
 * breakpoints MUST stay in sync: this bar used to hide at `md` while the
 * sidebar only appeared at `lg`, which left 768–1023px — iPad portrait,
 * most Android tablets, a split-screen laptop window — with no booking
 * UI on the page at all. The court was simply unbookable at those widths.
 */
export function MobileBookingBar({ startingPrice, venueName, venueTimezone, courts, phone, email, isAuthenticated, passOnFees, creditBalance }: MobileBookingBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`fixed inset-x-0 z-30 flex items-center gap-3.5 border-t border-border bg-card px-4 py-3 shadow-sheet ${BOOKING_BAR_VISIBILITY}`}
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
    >
      {/* "from", because this is the venue's cheapest court per hour and the
          sheet will quote the court the player actually picks. Without the
          prefix the two numbers read as a contradiction. */}
      <p className="shrink-0">
        {startingPrice !== null ? (
          <>
            <span className="block text-xs/4 text-muted-foreground">from</span>
            <span className="font-mono text-xl/6 font-semibold text-foreground">₱{startingPrice}</span>
            <span className="text-[0.8125rem]/[1.125rem] text-muted-foreground"> / hour</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Pricing unavailable</span>
        )}
      </p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="lg" className="flex-1">
            Book a court
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="overflow-y-auto p-0">
          <SheetTitle className="sr-only">Book a court</SheetTitle>
          <div className="px-5 pt-2 pb-7">
            <BookingWidget
              venueName={venueName}
              venueTimezone={venueTimezone}
              courts={courts}
              phone={phone}
              email={email}
              isAuthenticated={isAuthenticated}
              passOnFees={passOnFees}
              creditBalance={creditBalance}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
