import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listPayoutTransfers, decideTransferRetry } from "@/lib/services/payoutTransfers";
import { isPaymongoTransfersEnabled } from "@/lib/services/providers/paymongoTransfers";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import type { PayoutTransferStatus } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Transfers" };

const STATUS_STYLES: Record<PayoutTransferStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminTransfersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/transfers");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const transfers = await listPayoutTransfers(supabase);
  const enabled = isPaymongoTransfersEnabled();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />
      <div>
        <Link href="/admin/finance" className="text-sm text-muted-foreground hover:underline">
          ← Finance
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Transfers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Attempts to send money to venues. Read-only — transfers are initiated by backend service code, never from this page.
        </p>
      </div>

      {/* The state of the world, said plainly at the top. An admin looking
          at an empty table should know why it is empty. */}
      <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-foreground">
            Transfer execution is {enabled ? "flag-enabled but still unavailable" : "disabled"}.
          </p>
          <p className="mt-1 text-muted-foreground">
            AIR/Rally has no PayMongo wallet, so no source account exists to send from. Venues are paid by manual bank transfer.
            No transfer can be executed from this application, and no settlement can be marked paid.
          </p>
        </div>
      </div>

      {transfers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No transfer attempts recorded.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Batch</th>
                <th scope="col" className="px-4 py-3 font-medium">Venue</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                <th scope="col" className="px-4 py-3 font-medium">Our reference</th>
                <th scope="col" className="px-4 py-3 font-medium">Provider ID</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Attempted</th>
                <th scope="col" className="px-4 py-3 font-medium">If it needs attention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.map((transfer) => {
                const decision = decideTransferRetry({
                  status: transfer.status,
                  providerTransferId: transfer.provider_transfer_id,
                });
                return (
                  <tr key={transfer.id}>
                    <td className="px-4 py-3 text-foreground">{transfer.batchReference}</td>
                    <td className="px-4 py-3 text-muted-foreground">{transfer.venueName}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatSettlementMoney(transfer.amount, transfer.currency)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{transfer.reference_number}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {transfer.provider_transfer_id ?? <span className="text-warning">not confirmed</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[transfer.status]}`}>
                        {transfer.status}
                      </span>
                      {transfer.failure_reason && (
                        <span className="mt-1 block text-xs text-destructive">{transfer.failure_reason}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(transfer.created_at)}</td>
                    {/* Guidance, not a button. PayMongo publishes no
                        idempotency key for transfers, so a one-click retry
                        would be the most dangerous control in the app. */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">{decision.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        There is deliberately no retry button. PayMongo documents no idempotency key for transfers, so retrying without first
        looking the reference up could pay a venue twice.
      </p>
    </div>
  );
}
