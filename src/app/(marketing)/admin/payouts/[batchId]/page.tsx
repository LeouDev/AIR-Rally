import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getPayoutBatchDetail } from "@/lib/services/payouts";
import { PayoutBatchActions } from "@/components/admin/PayoutBatchActions";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import type { PayoutBatchStatus } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payout Batch" };

const STATUS_STYLES: Record<PayoutBatchStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  reviewing: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  processing: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export default async function PayoutBatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirect=/admin/payouts/${batchId}`);

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const detail = await getPayoutBatchDetail(supabase, batchId);
  if (!detail) notFound();

  const { batch, items, venueCount } = detail;
  const currency = items[0]?.currency ?? "PHP";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin/payouts" label="Back to payout batches" />
      <div>
        <Link href="/admin/payouts" className="text-sm text-muted-foreground hover:underline">
          ← Payout batches
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{batch.batch_reference}</h1>
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[batch.status]}`}>
            {batch.status}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Venues</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{venueCount}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Settlements</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{batch.settlement_count}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Total</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {formatSettlementMoney(batch.total_amount, currency)}
          </dd>
        </div>
      </dl>

      <PayoutBatchActions batchId={batch.id} status={batch.status} />

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Included settlements</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            This batch has no settlements.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Venue</th>
                  <th scope="col" className="px-4 py-3 font-medium">Booking</th>
                  <th scope="col" className="px-4 py-3 font-medium">Settlement</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.itemId}>
                    <td className="px-4 py-3 text-foreground">{item.venueName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.confirmationCode ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.settlementId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatSettlementMoney(item.amount, item.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        This batch is a preparation record. Paying these venues is a manual bank transfer outside AIR/Rally — no automated payout
        exists, and no settlement here is marked as paid.
      </p>
    </div>
  );
}
