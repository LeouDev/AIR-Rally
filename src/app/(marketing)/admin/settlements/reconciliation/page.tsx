import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, Wallet } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getSettlementIssues, getAdminSettlementSummary } from "@/lib/services/settlements";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import { BackLink } from "@/components/shared/BackLink";

// Runs the check live on every load — a cached reconciliation is worthless.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settlement Reconciliation" };

/** Plain-language names for the SQL rule identifiers. */
const ISSUE_LABELS: Record<string, string> = {
  missing_settlement: "Missing settlement",
  funding_mismatch: "Funding mismatch",
  live_settlement_on_cancelled_booking: "Live settlement on a cancelled booking",
  unfunded_entitlement: "Credit-funded entitlement",
};

const ISSUE_EXPLANATIONS: Record<string, string> = {
  missing_settlement: "A confirmed, priced booking has no settlement row. The venue is owed money nothing is tracking.",
  funding_mismatch: "A settlement's amounts no longer agree with its booking. The ledger and the booking have drifted apart.",
  live_settlement_on_cancelled_booking: "A cancelled booking still carries live entitlement. It should have been reversed.",
  unfunded_entitlement: "The venue is owed more than was collected in cash for this booking.",
};

export default async function SettlementReconciliationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/settlements/reconciliation");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [issues, summary] = await Promise.all([getSettlementIssues(supabase), getAdminSettlementSummary(supabase)]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin/settlements" label="Back to settlements" />
      <div>
        <Link href="/admin/settlements" className="text-sm text-muted-foreground hover:underline">
          ← Settlements
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Reconciliation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Integrity checks run directly in the database by <code className="text-xs">reconcile_settlements()</code>. A payout run
          must pass this before moving money.
        </p>
      </div>

      {/* Errors and exposure are deliberately separate. Mixing them would
          make a perfectly healthy credit-funded ledger look broken. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Ledger integrity</h2>
        {issues.errors.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/5 px-5 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
            <p className="text-sm font-medium text-foreground">No settlement issues detected.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
              <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                {issues.errors.length} issue(s) need attention before any payout run.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Issue</th>
                    <th scope="col" className="px-4 py-3 font-medium">Booking</th>
                    <th scope="col" className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {issues.errors.map((issue, index) => (
                    <tr key={`${issue.issue}-${issue.booking_id}-${index}`}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">{ISSUE_LABELS[issue.issue] ?? issue.issue}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{ISSUE_EXPLANATIONS[issue.issue] ?? ""}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{issue.booking_id}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{issue.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Wallet className="size-4 text-warning" aria-hidden />
            Platform cash exposure
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Not errors. Each of these is a booking a player paid for with AIR/Rally Credits, so the venue is owed money that was
            never collected in cash at the time. This is the platform&rsquo;s own obligation, funded from earlier receipts.
          </p>
        </div>

        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <p className="text-xs text-warning">Total exposure across unsettled bookings</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {formatSettlementMoney(summary.creditFundedExposure, summary.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {issues.exposure.length} booking(s). This must be genuinely funded before payouts are enabled.
          </p>
        </div>

        {issues.exposure.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Booking</th>
                  <th scope="col" className="px-4 py-3 font-medium">Shortfall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {issues.exposure.map((issue, index) => (
                  <tr key={`${issue.booking_id}-${index}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{issue.booking_id}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{issue.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
