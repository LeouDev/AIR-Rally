import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert, Wallet } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getAdminSettlementSummary, listAllSettlements } from "@/lib/services/settlements";
import type { SettlementSource, SettlementStatus } from "@/lib/supabase/types";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import { BackLink } from "@/components/shared/BackLink";

// Live financial position — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settlements" };

const SOURCE_LABELS: Record<SettlementSource, string> = {
  paymongo: "PayMongo",
  credit: "Credits",
  mixed: "Mixed",
};

const STATUS_STYLES: Record<SettlementStatus, string> = {
  pending: "bg-warning/15 text-warning",
  payable: "bg-success/15 text-success",
  settled: "bg-success/15 text-success",
  reversed: "bg-muted text-muted-foreground",
  on_hold: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: "Pending",
  payable: "Payable",
  settled: "Settled",
  reversed: "Reversed",
  on_hold: "On hold",
};

const FILTERS: { value: SettlementStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "payable", label: "Payable" },
  { value: "reversed", label: "Reversed" },
  { value: "on_hold", label: "On hold" },
];

function isSettlementStatus(value: string | undefined): value is SettlementStatus {
  return value === "pending" || value === "payable" || value === "settled" || value === "reversed" || value === "on_hold";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminSettlementsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/settlements");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { status } = await searchParams;
  const activeFilter = isSettlementStatus(status) ? status : undefined;

  const [summary, rows] = await Promise.all([
    getAdminSettlementSummary(supabase),
    listAllSettlements(supabase, { status: activeFilter }),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settlements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What AIR/Rally owes venues, and how much of it was actually collected in cash.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Total venue liability</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.totalVenueLiability, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">Pending + payable, not yet paid out.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Total collected</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.totalCollectedAmount, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">Real cash received via PayMongo on these bookings, 100%.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Pending</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.pendingAmount, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">{summary.pendingCount} booking(s), court time still to come.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Payable</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.payableAmount, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">{summary.payableCount} booking(s), delivered and earned.</p>
        </div>
        {/* Deliberately styled as a warning and never netted against the
            other figures: this is cash AIR/Rally owes but did not collect. */}
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <dt className="flex items-center gap-1.5 text-xs text-warning">
            <ShieldAlert className="size-3.5" aria-hidden />
            Credit-funded exposure
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.creditFundedExposure, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            Owed to venues but never collected in cash, because the player paid with credits.
          </p>
        </div>
        {/* A reversal withdraws the VENUE's entitlement, not the original
            charge — QR Ph can't be refunded through PayMongo's API, so
            this cash was never given back either. AIR/Rally keeps all of
            it, not just its usual platform fee. */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wallet className="size-3.5" aria-hidden />
            Retained from reversed
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.retainedFromReversedAmount, summary.currency)}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            Cash already collected on {summary.reversedCount} cancelled booking(s) — never refunded, never paid to the venue.
          </p>
        </div>
      </dl>

      {summary.onHoldCount > 0 && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {summary.onHoldCount} settlement(s) are on hold and need manual review.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">All settlements</h2>
          <Link href="/admin/settlements/reconciliation" className="text-sm font-medium text-primary hover:underline">
            Run reconciliation →
          </Link>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
          {FILTERS.map((filter) => {
            const isActive = filter.value === "all" ? !activeFilter : activeFilter === filter.value;
            return (
              <Link
                key={filter.value}
                href={filter.value === "all" ? "/admin/settlements" : `/admin/settlements?status=${filter.value}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            No settlements match this filter.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Venue</th>
                  <th scope="col" className="px-4 py-3 font-medium">Booking</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Gross</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Credit</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">PayMongo</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Platform fee</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Venue amount</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Cash position</th>
                  <th scope="col" className="px-4 py-3 font-medium">Source</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.settlementId}>
                    <td className="px-4 py-3 text-foreground">{row.venueName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="font-mono text-xs">{row.confirmationCode ?? "—"}</span>
                      <span className="block text-xs">{formatDate(row.bookingStartTime)}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatSettlementMoney(row.grossBookingAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatSettlementMoney(row.creditAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatSettlementMoney(row.paymongoAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatSettlementMoney(row.platformFee, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatSettlementMoney(row.venueAmount, row.currency)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        row.cashPosition < 0 ? "text-warning" : "text-muted-foreground"
                      }`}
                    >
                      {formatSettlementMoney(row.cashPosition, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{SOURCE_LABELS[row.settlementSource]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.settlementStatus]}`}
                      >
                        {STATUS_LABELS[row.settlementStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Nothing on this page moves money. Settlements reach &ldquo;settled&rdquo; only when an
        admin attests a transfer as sent on its payout batch — there is no automated payout.
      </p>
    </div>
  );
}
