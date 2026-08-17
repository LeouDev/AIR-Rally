import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listPayoutBatches, listPayoutCandidates } from "@/lib/services/payouts";
import { getPayoutReadiness } from "@/lib/services/payoutReadiness";
import { CreatePayoutBatchForm } from "@/components/admin/CreatePayoutBatchForm";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import type { PayoutBatchStatus } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payout Batches" };

const BATCH_STATUS_STYLES: Record<PayoutBatchStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  reviewing: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  processing: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminPayoutsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/payouts");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [batches, candidates, readiness] = await Promise.all([
    listPayoutBatches(supabase),
    listPayoutCandidates(supabase),
    getPayoutReadiness(supabase),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />
      <div>
        <Link href="/admin/finance" className="text-sm text-muted-foreground hover:underline">
          ← Finance
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Payout batches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Group earned settlements ahead of paying venues. Batches are internal records — creating or approving one never moves
          money.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Ready for payout</h2>
        <CreatePayoutBatchForm candidates={candidates} blocked={!readiness.ready} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Batches</h2>
        {batches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            No payout batches yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Batch</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Settlements</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/payouts/${batch.id}`} className="font-medium text-primary hover:underline">
                        {batch.batch_reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(batch.created_at)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{batch.settlement_count}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatSettlementMoney(batch.total_amount, "PHP")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${BATCH_STATUS_STYLES[batch.status]}`}>
                        {batch.status}
                      </span>
                    </td>
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
