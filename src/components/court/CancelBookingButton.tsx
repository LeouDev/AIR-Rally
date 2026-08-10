"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cancelBookingAction } from "@/lib/actions/booking";

type CancelBookingButtonProps = {
  bookingId: string;
  venueName: string;
  courtName: string;
  whenLabel: string;
};

/**
 * Always goes through cancelBookingAction (lib/actions/booking.ts) —
 * never updates booking status directly from the browser. No refund
 * logic exists in Phase 4B; the confirm step says so explicitly rather
 * than implying one happens.
 */
export function CancelBookingButton({ bookingId, venueName, courtName, whenLabel }: CancelBookingButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelBookingAction({ bookingId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Booking cancelled");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <p className="mt-2 text-muted-foreground">
            This will release the time slot and mark your booking as cancelled. Refunds aren&apos;t handled automatically
            yet — contact the venue directly if you paid and need one.
          </p>
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
