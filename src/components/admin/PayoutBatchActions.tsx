"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approvePayoutBatchAction, cancelPayoutBatchAction } from "@/lib/actions/payouts";
import type { PayoutBatchStatus } from "@/lib/supabase/types";

/**
 * Approve / cancel controls for a payout batch.
 *
 * "Approve" is a decision record, not an instruction to pay. The copy says
 * so explicitly at the point of action, because a button labelled only
 * "Approve payout" next to a peso total is exactly where someone would
 * reasonably assume money is about to move.
 */
export function PayoutBatchActions({ batchId, status }: { batchId: string; status: PayoutBatchStatus }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canApprove = status === "draft" || status === "reviewing";
  const canCancel = status === "draft" || status === "reviewing" || status === "approved";

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePayoutBatchAction({ batchId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Batch approved. No money has moved — settlements remain payable.");
      router.refresh();
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelPayoutBatchAction({ batchId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Batch cancelled. Its settlements are available again.");
      router.refresh();
    });
  }

  if (!canApprove && !canCancel) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <div>
        <p className="text-sm font-medium text-foreground">Batch actions</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Approving records that this batch is cleared to be paid. It does not transfer anything, and every settlement stays
          payable until a venue has genuinely been paid.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {canApprove && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Approve batch"}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel batch
          </button>
        )}
      </div>
    </div>
  );
}
