"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createCourtBlockAction } from "@/lib/actions/courtBlock";

/** Converts a <input type="datetime-local"> value (no timezone, treated as the browser's local time) to a real ISO instant. Fine here since the owner is physically operating this court, so "local" for them and "local" for the court's own timezone are the same in practice — same simplifying assumption BookingWidget's own date/time pickers already make. */
function toIsoInstant(datetimeLocalValue: string): string {
  return new Date(datetimeLocalValue).toISOString();
}

export function CourtBlockDialog({
  courtId,
  courtName,
  defaultDate,
  iconOnly = false,
}: {
  courtId: string;
  courtName: string;
  defaultDate: string;
  /** Icon-only trigger for tight spaces (e.g. a grid-timeline row header) — same dialog, no label text. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    const reason = (formData.get("reason") as string) || undefined;

    if (!startTime || !endTime) {
      toast.error("Pick a start and end time.");
      return;
    }

    startTransition(async () => {
      const result = await createCourtBlockAction({
        courtId,
        startTime: toIsoInstant(startTime),
        endTime: toIsoInstant(endTime),
        reason,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${courtName} blocked`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {iconOnly ? (
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Block time for ${courtName}`}>
            <Ban className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Ban className="size-4" />
            Block Time
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block time — {courtName}</DialogTitle>
          <DialogDescription>
            Prevents customers from booking this court during the selected window. No payment is involved.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-start">Start</Label>
              <Input id="block-start" name="startTime" type="datetime-local" defaultValue={`${defaultDate}T09:00`} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-end">End</Label>
              <Input id="block-end" name="endTime" type="datetime-local" defaultValue={`${defaultDate}T10:00`} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Input id="block-reason" name="reason" placeholder="Maintenance, private event, etc." maxLength={200} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Blocking…" : "Block Time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
