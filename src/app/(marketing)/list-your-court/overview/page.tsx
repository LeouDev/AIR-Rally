import type { Metadata } from "next";
import Link from "next/link";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOwnerDashboardSummary } from "@/lib/services/ownerBookings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner Overview",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

export default async function OwnerOverviewPage() {
  const user = await requireSignedIn("/list-your-court/overview");
  const supabase = await createClient();
  const summary = await getOwnerDashboardSummary(supabase, user.id);

  if (summary.today.length === 0) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Add your first venue to see today&apos;s bookings and this week&apos;s activity here.
        </p>
        <Link href="/list-your-court" className="text-sm font-medium text-primary hover:underline">
          Go to Venues →
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Today&apos;s activity and this week&apos;s numbers, across all your venues.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">This week</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Total bookings</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{summary.thisWeek.totalBookings}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Revenue (confirmed)</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">
              {formatMoney(summary.thisWeek.totalRevenue, summary.thisWeek.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Most booked court</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{summary.thisWeek.mostBookedCourtName ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Today, by venue</h2>
        {summary.today.map((venue) => (
          <div key={venue.venueId} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-foreground">{venue.venueName}</h3>
              <Link href={`/list-your-court/${venue.venueId}/availability`} className="text-sm font-medium text-primary hover:underline">
                View calendar →
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">Bookings today</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{venue.bookingsToday}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Occupied hours</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{venue.occupiedHours}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Available hours</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{venue.availableHours}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
