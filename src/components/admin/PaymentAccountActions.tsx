"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPaymentAccountStatusAction } from "@/lib/actions/paymentAccounts";
import type { VenuePaymentAccountStatus } from "@/lib/supabase/types";

/**
 * Marks a venue's payment account verified or restricted.
 *
 * Only these two are offered. `not_connected` and `pending_verification`
 * mirror what PayMongo reports and are maintained by a trigger — an admin
 * asserting them would put a second writer on the same fact. `disabled`
 * exists in the model but is deliberately not a one-click action; switching
 * a venue off permanently should be a deliberate support decision, not a
 * button next to "restrict".
 */
export function PaymentAccountActions({ venueId, status }: { venueId: string; status: VenuePaymentAccountStatus }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function update(next: "verified" | "restricted") {
    startTransition(async () => {
      const result = await setPaymentAccountStatusAction({ venueId, status: next });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(next === "verified" ? "Payment account marked verified." : "Payment account restricted.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "verified" && (
        <button
          type="button"
          onClick={() => update("verified")}
          disabled={isPending}
          className="rounded-full border border-success/40 px-3 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
        >
          Mark verified
        </button>
      )}
      {status !== "restricted" && (
        <button
          type="button"
          onClick={() => update("restricted")}
          disabled={isPending}
          className="rounded-full border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          Restrict
        </button>
      )}
    </div>
  );
}
