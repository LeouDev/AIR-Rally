"use client";

import { Button } from "@/components/ui/button";

type MobileBookingBarProps = {
  startingPrice: number | null;
  targetId: string;
};

/**
 * Airbnb-style persistent price + CTA bar, mobile only (the sidebar
 * BookingWidget is already visible and sticky at sm/lg widths). Sits
 * just above MobileNav rather than covering it — see the bottom offset
 * below, which mirrors MobileNav's own env(safe-area-inset-bottom)
 * handling so it clears the home-indicator area on notched phones too.
 */
export function MobileBookingBar({ startingPrice, targetId }: MobileBookingBarProps) {
  function scrollToBooking() {
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
      <Button onClick={scrollToBooking} size="lg" className="shrink-0">
        Book a court
      </Button>
    </div>
  );
}
