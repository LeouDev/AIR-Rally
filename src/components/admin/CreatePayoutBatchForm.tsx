"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPayoutBatchAction } from "@/lib/actions/payouts";
import type { PayoutCandidate } from "@/lib/services/payouts";
import { formatSettlementMoney } from "@/lib/settlementFormat";

/**
 * Selects payable settlements and creates a draft batch.
 *
 * The running total here is a preview only. The batch's real total is
 * recomputed by a database trigger from the items that actually landed, so
 * a stale or tampered selection can't produce a batch whose total disagrees
 * with its contents.
 */
export function CreatePayoutBatchForm({ candidates, blocked }: { candidates: PayoutCandidate[]; blocked: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(settlementId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(settlementId)) next.delete(settlementId);
      else next.add(settlementId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => (current.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.settlementId))));
  }

  const selectedTotal = candidates
    .filter((c) => selected.has(c.settlementId))
    .reduce((sum, c) => sum + c.amount, 0);
  const currency = candidates[0]?.currency ?? "PHP";

  function handleCreate() {
    startTransition(async () => {
      const result = await createPayoutBatchAction({ settlementIds: [...selected] });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft payout batch created. No money has moved.");
      setSelected(new Set());
      router.push(`/admin/payouts/${result.data.batchId}`);
    });
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No settlements are ready for payout. Settlements become available once their court time has been delivered.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {blocked && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Reconciliation issues are unresolved, so new batches are blocked. Fix them before preparing a payout.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          {selected.size === candidates.length ? "Clear selection" : "Select all"}
        </button>
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {selected.size} selected ·{" "}
            <span className="font-semibold tabular-nums text-foreground">{formatSettlementMoney(selectedTotal, currency)}</span>
          </p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending || selected.size === 0 || blocked}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create draft batch"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="px-4 py-3 font-medium">Venue</th>
              <th scope="col" className="px-4 py-3 font-medium">Booking</th>
              <th scope="col" className="px-4 py-3 font-medium">Paid with</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {candidates.map((candidate) => (
              <tr key={candidate.settlementId} className={selected.has(candidate.settlementId) ? "bg-accent/40" : undefined}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.settlementId)}
                    onChange={() => toggle(candidate.settlementId)}
                    aria-label={`Include ${candidate.venueName} settlement in batch`}
                    className="size-4 rounded border-border"
                  />
                </td>
                <td className="px-4 py-3 text-foreground">{candidate.venueName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{candidate.confirmationCode ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {candidate.settlementSource === "paymongo" ? "PayMongo" : candidate.settlementSource === "credit" ? "Credits" : "Mixed"}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                  {formatSettlementMoney(candidate.amount, candidate.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
