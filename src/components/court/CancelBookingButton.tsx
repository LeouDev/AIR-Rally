"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cancelBookingAction, previewCancellationAction } from "@/lib/actions/booking";
import type { CancellationCreditDecision } from "@/lib/services/credits";

type CancelBookingButtonProps = {
  bookingId: string;
  venueName: string;
  courtName: string;
  whenLabel: string;
};

function formatMoney(amountMinorUnits: number): string {
  return `₱${(amountMinorUnits / 100).toFixed(2)}`;
}

/**
 * Always goes through cancelBookingAction (lib/actions/booking.ts) — never
 * updates booking status directly from the browser.
 *
 * The dialog states what happens to the money BEFORE the customer commits,
 * via previewCancellationAction — read-only, cancels nothing. Cancelling
 * without saying where the payment went reads as "they kept it", which is how
 * a refund becomes a support ticket.
 *
 * Both the preview and the outcome show the backend's own `reason` string
 * rather than re-deriving the rule here. The cutoff is a business number
 * (CANCELLATION_CREDIT_CUTOFF_HOURS, currently 48) and a component that
 * reimplements it would eventually state a different one with total
 * confidence — the design doc already says 24.
 */
export function CancelBookingButton({ bookingId, venueName, courtName, whenLabel }: CancelBookingButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<CancellationCreditDecision | null>(null);
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPreview(null);
      return;
    }
    // Read-only: works out what the customer would get back, without
    // cancelling anything.
    previewCancellationAction({ bookingId }).then((result) => {
      if (result.success) setPreview(result.data);
    });
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelBookingAction({ bookingId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const { credit } = result.data;
      toast.success(
        credit.issued && credit.amount > 0
          ? `Booking cancelled — ${formatMoney(credit.amount)} added to your AIR/Rally Credits.`
          : "Booking cancelled."
      );
      setOpen(false);
      setPreview(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Cancel booking
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-foreground">
            <span className="font-medium">{courtName}</span> at {venueName}
          </p>
          <p className="text-muted-foreground">{whenLabel}</p>
          <p className="mt-2 text-subtle">
            This releases the time slot to other players and marks your booking as cancelled.
          </p>

          {/* What happens to the money, stated before they commit. The amount
              is the COURT PRICE, not the total charged — the online payment
              fee is consumed by the payment provider and never returns, so a
              ₱406.09 booking credits back ₱400.00. */}
          {preview && (
            <div
              className={
                preview.eligible
                  ? "mt-1 flex flex-col gap-1 rounded-lg bg-success-soft px-3.5 py-3 text-success-soft-foreground"
                  : "mt-1 flex flex-col gap-1 rounded-lg bg-warning-soft px-3.5 py-3 text-warning-soft-foreground"
              }
            >
              <p className="font-semibold">
                {preview.eligible
                  ? `You'll get ${formatMoney(preview.amount)} back in AIR/Rally Credits`
                  : "No credits for this cancellation"}
              </p>
              <p className="text-[0.8125rem]/[1.125rem]">{preview.reason}</p>
              {preview.eligible && (
                <p className="text-[0.8125rem]/[1.125rem]">
                  Credits never expire, and booking with them carries no online payment fee.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Keep booking
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Cancelling…" : "Yes, cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
