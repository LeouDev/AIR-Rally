"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AvailabilitySelector } from "@/components/court/AvailabilitySelector";
import { activePaymentProvider } from "@/lib/services/payments";
import type { Court } from "@/types/court";

type BookingPanelProps = {
  court: Court;
};

export function BookingPanel({ court }: BookingPanelProps) {
  const [selection, setSelection] = useState<{ date: string; slotId: string } | null>(null);

  async function handleBook() {
    if (!selection) {
      toast.error("Pick a time slot first");
      return;
    }
    const result = await activePaymentProvider.createCheckout({
      courtId: court.id,
      date: selection.date,
      slotIds: [selection.slotId],
      amount: court.pricePerHour,
      currency: "PHP",
    });
    toast.info(result.message);
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-semibold text-foreground">
          ₱{court.pricePerHour}
          <span className="text-sm font-normal text-muted-foreground"> / hour</span>
        </p>
      </div>

      <AvailabilitySelector
        availability={court.availability}
        onSelectSlot={(date, slotId) => setSelection({ date, slotId })}
      />

      <Button size="lg" className="h-12 w-full text-base" onClick={handleBook}>
        Book Court
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        You won&apos;t be charged yet — payments arrive in a later phase.
      </p>
    </div>
  );
}
