"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { User, MapPin, CreditCard, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/supabase/types";
import type { OwnerBookingWithDetails } from "@/lib/services/ownerBookings";

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-warning/15 text-warning",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * Read-only booking detail — no modify/refund controls by design (owners
 * cannot touch payment records or issue refunds; see
 * `src/lib/services/ownerBookings.ts`'s own doc comment for the RLS
 * posture behind this). Used both from the Bookings list (row already
 * loaded, passed straight in) and from the Calendar (fetched fresh on
 * click, since the RPC's slot rows don't carry this full shape).
 */
export function BookingDetailDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: OwnerBookingWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {booking && (
          <>
            <DialogHeader>
              <DialogTitle>{booking.customerName}</DialogTitle>
              <DialogDescription>Confirmation {booking.confirmationCode}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={cn("border-transparent", STATUS_STYLES[booking.status])}>{STATUS_LABELS[booking.status]}</Badge>
              </div>

              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">
                    {booking.venueName} · {booking.courtName}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDateTime(booking.startTime, booking.venueTimezone)} –{" "}
                    {formatDateTime(booking.endTime, booking.venueTimezone)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{booking.customerName}</span>
              </div>

              <div className="flex items-center gap-2">
                <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  {formatMoney(booking.priceAmount, booking.currency)}
                  {booking.paidAt ? ` · paid ${formatDateTime(booking.paidAt, booking.venueTimezone)}` : " · unpaid"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">Booked {formatDateTime(booking.createdAt, booking.venueTimezone)}</span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
