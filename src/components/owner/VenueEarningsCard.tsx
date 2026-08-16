import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VenueEarningsSummary } from "@/lib/services/venueEarnings";
import type { BookingStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type VenueEarningsCardProps = {
  earnings: VenueEarningsSummary;
};

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-warning/15 text-warning",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Payment pending",
  confirmed: "Paid",
  cancelled: "Cancelled",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

/**
 * Purely a display of the server-computed VenueEarningsSummary (see
 * lib/services/venueEarnings.ts) — never recomputes anything itself.
 *
 * Deliberately never says "received," "paid out," or "in your account"
 * anywhere in this file — see the long doc comment on getVenueEarnings()
 * for why. The banner below is not boilerplate; it's the one thing this
 * component exists to make impossible to miss.
 */
export function VenueEarningsCard({ earnings }: VenueEarningsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bookings &amp; earnings</CardTitle>
        <CardDescription>What customers have paid for bookings at this venue.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          <strong className="font-medium text-warning">This is not a statement of funds paid out to you.</strong> A booking showing
          as &quot;Paid&quot; means the customer&apos;s payment succeeded — it does not mean AIR/Rally has settled or
          transferred any amount to you. Payout automation is not yet live; contact AIR/Rally directly about
          compensation for confirmed bookings. The same applies to any refund figure shown below: it reflects what
          PayMongo&apos;s own refund response reported, not a confirmed debit from your bank account.
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Customer payments (confirmed)</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{formatMoney(earnings.grossConfirmed, earnings.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Refunded</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{formatMoney(earnings.refunded, earnings.currency)}</dd>
          </div>
          {earnings.splitVenueAmount > 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">Requested venue split (PayMongo, unsettled)</dt>
              <dd className="mt-1 text-lg font-semibold text-foreground">{formatMoney(earnings.splitVenueAmount, earnings.currency)}</dd>
            </div>
          )}
        </dl>

        {earnings.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings yet for this venue&apos;s courts.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {earnings.rows.map((row) => (
              <li key={row.bookingId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{row.courtName}</p>
                    <Badge className={cn("border-transparent", STATUS_STYLES[row.status])}>{STATUS_LABELS[row.status]}</Badge>
                    {row.wasRescheduled && <Badge className="border-transparent bg-muted text-muted-foreground">Rescheduled</Badge>}
                    {row.isRescheduleReplacement && <Badge className="border-transparent bg-muted text-muted-foreground">From reschedule</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(row.startTime).toLocaleDateString("en-US", { dateStyle: "medium" })} · {row.confirmationCode} · {row.paymentProvider}
                  </p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className="font-medium text-foreground">{formatMoney(row.priceAmount, row.currency)}</p>
                  {row.refundedAmount > 0 && (
                    <p className="text-xs text-destructive">Refunded {formatMoney(row.refundedAmount, row.currency)}</p>
                  )}
                  {row.venueAmount != null && (
                    <p className="text-xs text-muted-foreground">Requested split: {formatMoney(row.venueAmount, row.currency)}</p>
                  )}
                  {row.venueRefundAmount != null && row.venueAmount != null && (
                    <p className="text-xs text-muted-foreground">
                      Refund impact: {formatMoney(row.venueRefundAmount, row.currency)}
                      {row.venueRefundAmount !== row.venueAmount && (
                        <span className="text-destructive"> (not equal to your original share — see the refund policy)</span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
