"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BookingWidget } from "@/components/court/BookingWidget";
import type { Court } from "@/lib/supabase/types";

type MobileBookingBarProps = {
  startingPrice: number | null;
  venueName: string;
  venueTimezone: string;
  courts: Court[];
  phone: string | null;
  email: string | null;
  isAuthenticated: boolean;
};

/**
 * Airbnb-style persistent price + CTA bar, mobile only (the sidebar
 * BookingWidget is already visible and sticky at sm/lg widths, and
 * stays the only booking UI there — this bar and its sheet render
 * nothing above md). Tapping "Book a court" pops the exact same
 * BookingWidget up as a bottom sheet rather than the page carrying a
 * second always-visible copy of it inline.
 */
export function MobileBookingBar({ startingPrice, venueName, venueTimezone, courts, phone, email, isAuthenticated }: MobileBookingBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="fixed inset-x-0 z-30 flex items-center justify-between gap-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
    >
      <p className="text-sm text-muted-foreground">
        {startingPrice !== null ? (
          <>
            <span className="text-base font-semibold text-foreground">₱{startingPrice}</span> / hour
          </>
        ) : (
          "Pricing unavailable"
        )}
      </p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="lg" className="shrink-0">
            Book a court
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0">
          <SheetTitle className="sr-only">Book a court</SheetTitle>
          <div className="p-4 pt-6">
            <BookingWidget
              venueName={venueName}
              venueTimezone={venueTimezone}
              courts={courts}
              phone={phone}
              email={email}
              isAuthenticated={isAuthenticated}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
