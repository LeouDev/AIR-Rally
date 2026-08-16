import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getPayoutReadiness } from "@/lib/services/payoutReadiness";
import { getAdminSettlementSummary } from "@/lib/services/settlements";
import { formatSettlementMoney } from "@/lib/settlementFormat";

// Live financial position — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Finance" };

function Card({
  label,
  amount,
  currency,
  hint,
  tone = "neutral",
}: {
  label: string;
  amount: number;
  currency: string;
  hint: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className={`rounded-2xl border p-6 ${tone === "warning" ? "border-warning/40 bg-warning/5" : "border-border bg-card"}`}>
      <dt className={`text-xs ${tone === "warning" ? "text-warning" : "text-muted-foreground"}`}>{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatSettlementMoney(amount, currency)}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export default async function AdminFinancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/finance");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [readiness, summary] = await Promise.all([getPayoutReadiness(supabase), getAdminSettlementSummary(supabase)]);
  const { cash } = readiness;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What AIR/Rally owes venues, what it holds in cash, and whether a payout can responsibly be prepared.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          label="Total venue liability"
          amount={summary.totalVenueLiability}
          currency={cash.currency}
          hint="Everything owed and not yet paid."
        />
        <Card label="Pending settlements" amount={cash.pendingAmount} currency={cash.currency} hint="Court time not yet delivered." />
        <Card
          label="Ready for payout"
          amount={cash.availablePayableAmount}
          currency={cash.currency}
          hint="Delivered and earned. Includes anything already batched."
        />
        <Card
          label="Credit exposure"
          amount={cash.creditFundedExposure}
          currency={cash.currency}
          hint="Owed to venues but never collected in cash."
          tone="warning"
        />
        <Card
          label="On hold"
          amount={cash.onHoldAmount}
          currency={cash.currency}
          hint="Needs manual review before it can be paid."
          tone={cash.onHoldAmount > 0 ? "warning" : "neutral"}
        />
        <Card
          label="Committed to batches"
          amount={cash.batchedAmount}
          currency={cash.currency}
          hint="Already inside a live payout batch."
        />
      </dl>

      {/* The number that decides whether payouts are affordable, given its
          own row rather than buried among the cards above. */}
      <div
        className={`rounded-2xl border p-6 ${
          cash.cashPositionTotal < 0 ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"
        }`}
      >
        <p className="text-xs text-muted-foreground">Net cash position on live settlements</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
          {formatSettlementMoney(cash.cashPositionTotal, cash.currency)}
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {cash.cashPositionTotal < 0
            ? "Negative: paying every payable settlement would cost more than those bookings collected. The shortfall is funded from money taken on other bookings, because players paid with AIR/Rally Credits."
            : "Positive: the bookings behind these settlements collected more cash than is owed out on them."}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Payout readiness</h2>

        {readiness.ready ? (
          <div className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/5 px-5 py-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">Ready for payout preparation</p>
              <p className="mt-0.5 text-sm text-muted-foreground">No reconciliation issues found.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">Payout blocked</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {readiness.blockers.length} unresolved reconciliation issue(s) must be fixed first.
                </p>
              </div>
            </div>
            <ul className="ml-8 list-disc text-sm text-muted-foreground">
              {readiness.blockers.slice(0, 5).map((blocker, index) => (
                <li key={`${blocker.issue}-${blocker.bookingId}-${index}`}>
                  <span className="font-medium text-foreground">{blocker.issue}</span> — {blocker.detail}
                </li>
              ))}
            </ul>
            <Link href="/admin/settlements/reconciliation" className="ml-8 text-sm font-medium text-primary hover:underline">
              Open reconciliation →
            </Link>
          </div>
        )}

        {/* Warnings are things to accept knowingly, not defects — kept
            visually distinct from blockers for exactly that reason. */}
        {readiness.warnings.length > 0 && (
          <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert className="size-4 text-warning" aria-hidden />
              Consider before paying out
            </p>
            <ul className="ml-6 list-disc text-sm text-muted-foreground">
              {readiness.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/payouts"
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Payout batches
          </Link>
          <Link
            href="/admin/settlements"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            All settlements
          </Link>
        </div>
      </section>

      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        No payout automation exists. Batches are internal preparation records — approving one does not transfer money or mark any
        settlement as paid.
      </p>
    </div>
  );
}
