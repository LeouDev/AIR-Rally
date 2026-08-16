import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ShieldAlert, Undo2, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listPaymentMonitoringRows, listVenuePaymentIssues, type PaymentLifecycleStatus, type PaymentMonitoringRow, type RefundDetail } from "@/lib/services/adminPayments";
import { listRescheduleActivity, type RescheduleActivityRow } from "@/lib/services/reschedules";
import type { RefundStatus, RescheduleStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Real, per-request admin view over live payment state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payment Monitoring" };

const LIFECYCLE_STYLES: Record<PaymentLifecycleStatus, string> = {
  pending: "bg-warning/15 text-warning",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
  partially_refunded: "bg-warning/15 text-warning",
  refunded: "bg-destructive/10 text-destructive",
};

const LIFECYCLE_LABELS: Record<PaymentLifecycleStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
};

const REFUND_STATUS_STYLES: Record<RefundStatus, string> = {
  pending: "bg-warning/15 text-warning",
  provider_unavailable: "bg-warning/15 text-warning",
  succeeded: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
};

const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: "Pending",
  provider_unavailable: "Provider unavailable — manual handling required",
  succeeded: "Succeeded",
  failed: "Failed",
};

const REFUND_BASIS_LABELS: Record<NonNullable<RefundDetail["refundBasis"]>, string> = {
  gross_only: "Gross only (fee not refunded)",
  gross_plus_fee: "Gross + customer fee",
};

const RESCHEDULE_STATUS_STYLES: Record<RescheduleStatus, string> = {
  pending_payment: "bg-warning/15 text-warning",
  pending_refund: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
  provider_unavailable: "bg-warning/15 text-warning",
};

const RESCHEDULE_STATUS_LABELS: Record<RescheduleStatus, string> = {
  pending_payment: "Awaiting difference payment",
  pending_refund: "Awaiting refund",
  completed: "Completed",
  failed: "Failed",
  provider_unavailable: "Provider unavailable — manual handling required",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

function formatSignedMoney(amountMinorUnits: number, currency: string): string {
  const sign = amountMinorUnits > 0 ? "+" : amountMinorUnits < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(amountMinorUnits), currency)}`;
}

function countBy(rows: PaymentMonitoringRow[], status: PaymentLifecycleStatus): number {
  return rows.filter((r) => r.lifecycleStatus === status).length;
}

export default async function AdminPaymentsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/payments");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [rows, venueIssues, reschedules] = await Promise.all([
    listPaymentMonitoringRows(supabase),
    listVenuePaymentIssues(supabase),
    listRescheduleActivity(supabase),
  ]);
  const flaggedRows = rows.filter((r) => r.reconciliationFlags.length > 0);
  const refundRows = rows.filter((r) => r.refunds.length > 0);
  const statuses: PaymentLifecycleStatus[] = ["pending", "confirmed", "partially_refunded", "refunded", "cancelled"];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Payment Monitoring</h1>
      <p className="mt-1 text-muted-foreground">
        Live view over every booking&apos;s payment state. Showing the {rows.length} most recent bookings.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {statuses.map((status) => (
          <div key={status} className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2">
            <Badge className={cn("border-transparent", LIFECYCLE_STYLES[status])}>{LIFECYCLE_LABELS[status]}</Badge>
            <span className="text-sm font-medium text-foreground">{countBy(rows, status)}</span>
          </div>
        ))}
      </div>

      {flaggedRows.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
            Reconciliation issues ({flaggedRows.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {flaggedRows.map((row) => (
              <li key={row.bookingId} className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">
                    {row.venueName} · {row.courtName} · {row.confirmationCode}
                  </p>
                  <Badge className={cn("border-transparent", LIFECYCLE_STYLES[row.lifecycleStatus])}>{LIFECYCLE_LABELS[row.lifecycleStatus]}</Badge>
                </div>
                <ul className="mt-2 list-inside list-disc text-sm text-destructive">
                  {row.reconciliationFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {refundRows.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Undo2 className="size-5 text-muted-foreground" aria-hidden />
            Refund activity ({refundRows.length})
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform/venue split amounts are shown only when PayMongo&apos;s own refund response actually reported them —
            never estimated. See the PayMongo Refund &amp; Cancellation Accounting Design Report for why a refund does
            not simply mirror the original 95/5 split.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {refundRows.map((row) =>
              row.refunds.map((refund) => {
                const venueNetImpact =
                  refund.venueRefundAmount != null && row.venueAmount != null ? refund.venueRefundAmount - row.venueAmount : null;
                return (
                  <li key={refund.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {row.venueName} · {row.courtName} · {row.confirmationCode}
                      </p>
                      <Badge className={cn("border-transparent", REFUND_STATUS_STYLES[refund.status])}>{REFUND_STATUS_LABELS[refund.status]}</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Requested amount</dt>
                        <dd className="text-foreground">{formatMoney(refund.amount, row.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Basis</dt>
                        <dd className="text-foreground">{refund.refundBasis ? REFUND_BASIS_LABELS[refund.refundBasis] : "Not yet chosen"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Platform refund amount</dt>
                        <dd className="text-foreground">
                          {refund.platformRefundAmount != null ? formatMoney(refund.platformRefundAmount, row.currency) : "Not yet known"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Venue refund amount</dt>
                        <dd className="text-foreground">
                          {refund.venueRefundAmount != null ? formatMoney(refund.venueRefundAmount, row.currency) : "Not yet known"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Venue net impact</dt>
                        <dd className={cn("font-medium", venueNetImpact != null && venueNetImpact < 0 ? "text-destructive" : "text-foreground")}>
                          {venueNetImpact != null ? formatSignedMoney(venueNetImpact, row.currency) : "Not yet known"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Provider availability estimate</dt>
                        <dd className="text-foreground">
                          {refund.providerAvailableAt ? new Date(refund.providerAvailableAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : "Unknown"}
                        </dd>
                      </div>
                    </dl>
                    {refund.failureReason && <p className="mt-2 text-sm text-destructive">{refund.failureReason}</p>}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      )}

      {reschedules.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
            Reschedule activity ({reschedules.length})
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            V1 rescheduling: at most once per booking, only ≥24h before the original start time, same venue only. A
            price increase charges only the difference via a new checkout; a price decrease refunds only the gross
            difference (never the customer fee) via the existing refund machinery.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {reschedules.map((reschedule: RescheduleActivityRow) => (
              <li key={reschedule.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">
                    {reschedule.originalVenueName} · {reschedule.originalCourtName} · {reschedule.originalConfirmationCode} → {reschedule.newConfirmationCode}
                  </p>
                  <Badge className={cn("border-transparent", RESCHEDULE_STATUS_STYLES[reschedule.status])}>
                    {RESCHEDULE_STATUS_LABELS[reschedule.status]}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Price difference</dt>
                    <dd className="text-foreground">{formatSignedMoney(reschedule.priceDifference, reschedule.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Requested</dt>
                    <dd className="text-foreground">{new Date(reschedule.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</dd>
                  </div>
                  {reschedule.reason && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Reason</dt>
                      <dd className="text-foreground">{reschedule.reason}</dd>
                    </div>
                  )}
                </dl>
                {reschedule.failureReason && <p className="mt-2 text-sm text-destructive">{reschedule.failureReason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {venueIssues.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ShieldAlert className="size-5 text-warning" aria-hidden />
            Venue payment-readiness issues ({venueIssues.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {venueIssues.map((issue) => (
              <li key={`${issue.venueId}-${issue.kind}`} className="rounded-2xl border border-border bg-card p-3 text-sm">
                <span className="font-medium text-foreground">{issue.venueName}</span>
                <span className="text-muted-foreground"> — {issue.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">All bookings</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No bookings yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Booking</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Refunded</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.bookingId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{row.venueName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.courtName} · {row.confirmationCode}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn("border-transparent", LIFECYCLE_STYLES[row.lifecycleStatus])}>{LIFECYCLE_LABELS[row.lifecycleStatus]}</Badge>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{row.paymentProvider}</td>
                    <td className="px-4 py-3 text-foreground">{formatMoney(row.priceAmount, row.currency)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.refundedAmount > 0 ? formatMoney(row.refundedAmount, row.currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
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
