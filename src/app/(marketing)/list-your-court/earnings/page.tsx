import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOwnerAnalytics, type RevenuePeriod } from "@/lib/services/ownerAnalytics";
import { getOwnerSettlementSummary, listOwnerSettlements } from "@/lib/services/settlements";
import { SettlementPanel } from "@/components/owner/SettlementPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Earnings",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:00 ${period}`;
}

function RevenueCard({ label, period, currency }: { label: string; period: RevenuePeriod; currency: string }) {
  const hasComparison = period.changePct !== null;
  const isUp = hasComparison && period.changePct! >= 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(period.amount, currency)}</dd>
      {hasComparison && (
        <p className={`mt-1 text-xs font-medium ${isUp ? "text-emerald-600" : "text-red-600"}`}>
          {isUp ? "↑" : "↓"} {formatPct(Math.abs(period.changePct!))} vs. previous period
        </p>
      )}
    </div>
  );
}

export default async function OwnerEarningsPage() {
  const user = await requireSignedIn("/list-your-court/earnings");
  const supabase = await createClient();
  // Settlement reads carry no owner id: booking_settlements' RLS policy
  // already scopes them to venues this caller owns. Passing an id would
  // imply the filtering happened here rather than in the database.
  const [analytics, settlementSummary, settlementRows] = await Promise.all([
    getOwnerAnalytics(supabase, user.id),
    getOwnerSettlementSummary(supabase),
    listOwnerSettlements(supabase),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What you have earned and what you are owed, plus occupancy and booking activity across your venues.
        </p>
      </div>

      {/* Settlements lead: "what am I owed" is the question an owner opens
          this page to answer. The revenue/occupancy analytics below are
          Phase 7.2 and stay exactly as they were. */}
      <SettlementPanel summary={settlementSummary} rows={settlementRows} />

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Revenue</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <RevenueCard label="Today" period={analytics.revenue.today} currency={analytics.currency} />
          <RevenueCard label="This week" period={analytics.revenue.thisWeek} currency={analytics.currency} />
          <RevenueCard label="This month" period={analytics.revenue.thisMonth} currency={analytics.currency} />
        </dl>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Occupancy this month</h2>
        {analytics.occupancy.perCourt.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Add your first venue and court to see occupancy here.
          </p>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-6">
            <dl className="flex flex-col gap-4">
              {analytics.occupancy.perCourt.map((court) => (
                <div key={court.courtId} className="flex items-center justify-between gap-4">
                  <dt className="text-sm font-medium text-foreground">{court.courtName}</dt>
                  <dd className="flex items-center gap-3">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, (court.occupancyPct ?? 0) * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-sm text-muted-foreground">
                      {court.occupancyPct === null ? "—" : formatPct(court.occupancyPct)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {(analytics.occupancy.mostBookedCourts.length > 0 || analytics.occupancy.peakHour !== null) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {analytics.occupancy.mostBookedCourts.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-6">
                <h3 className="text-sm font-semibold text-foreground">Most booked courts</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {analytics.occupancy.mostBookedCourts.map((court) => (
                    <li key={court.courtId} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{court.courtName}</span>
                      <span className="font-medium text-foreground">{court.bookingCount} bookings</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analytics.occupancy.peakHour !== null && (
              <div className="rounded-2xl border border-border bg-card p-6">
                <h3 className="text-sm font-semibold text-foreground">Peak &amp; quiet hours</h3>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Busiest</dt>
                    <dd className="font-medium text-foreground">{formatHour(analytics.occupancy.peakHour)}</dd>
                  </div>
                  {analytics.occupancy.lowestHour !== null && (
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Quietest</dt>
                      <dd className="font-medium text-foreground">{formatHour(analytics.occupancy.lowestHour)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Booking insights this month</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6">
            <dt className="text-xs text-muted-foreground">Total bookings</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{analytics.bookingInsights.totalBookings}</dd>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <dt className="text-xs text-muted-foreground">Repeat customers</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{analytics.bookingInsights.repeatCustomers}</dd>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <dt className="text-xs text-muted-foreground">Cancellation rate</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{formatPct(analytics.bookingInsights.cancellationRate)}</dd>
          </div>
        </dl>
      </div>

      <p className="text-xs text-muted-foreground">
        Figures above reflect what customers have paid, not funds settled to your bank account. Payout and settlement
        tracking are not yet available.
      </p>
    </div>
  );
}
