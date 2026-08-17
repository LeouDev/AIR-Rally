"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustUserCreditAction } from "@/lib/actions/credits";

/**
 * Grants or deducts credit for one user.
 *
 * Credit is money-like and the ledger is append-only — a mistake here
 * cannot be edited away, only offset by a second entry that is itself
 * permanent. So this deliberately does NOT optimise for speed of entry:
 * the direction is an explicit choice rather than a minus sign someone
 * can fat-finger, the amount is shown back in pesos before submitting,
 * and a reason is required.
 *
 * Amounts are entered in PESOS and converted to centavos here, because
 * asking a human to type 50000 for ₱500 is how a 100x error happens. The
 * conversion is the only arithmetic in this component; every rule
 * (admin-only, non-empty reason, no overdraw) is enforced in the database.
 */
export function CreditAdjustForm({ userId, displayName }: { userId: string; displayName: string }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"grant" | "deduct">("grant");
  const [pesos, setPesos] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, startSubmit] = useTransition();

  const parsed = Number(pesos);
  const validAmount = pesos.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  // Rounded, not truncated, and done once — ₱12.185 is a typo, not a value.
  const centavos = validAmount ? Math.round(parsed * 100) : 0;
  const canSubmit = validAmount && centavos > 0 && reason.trim().length > 0 && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    startSubmit(async () => {
      const result = await adjustUserCreditAction({
        userId,
        amount: direction === "grant" ? centavos : -centavos,
        reason: reason.trim(),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `${direction === "grant" ? "Granted" : "Deducted"} ₱${(centavos / 100).toFixed(2)} — new balance ₱${(result.data.balance / 100).toFixed(2)}`
      );
      setPesos("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Adjust balance</h2>
        <p className="text-xs text-muted-foreground">
          This is permanent. The ledger is append-only — a mistake is corrected with a second, offsetting adjustment, never an edit.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Direction</Label>
        <div className="flex gap-2">
          {(["grant", "deduct"] as const).map((d) => (
            <Button
              key={d}
              type="button"
              variant={direction === d ? "default" : "outline"}
              onClick={() => setDirection(d)}
              className="flex-1 capitalize"
            >
              {d}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="credit-amount">Amount (₱)</Label>
        <Input
          id="credit-amount"
          inputMode="decimal"
          placeholder="500.00"
          value={pesos}
          onChange={(e) => setPesos(e.target.value)}
        />
        {validAmount && (
          // Shown back before submitting: the value that actually reaches
          // the ledger is centavos, and this is the last chance to notice
          // a misplaced decimal point.
          <p className="text-xs text-muted-foreground">
            {direction === "grant" ? "Granting" : "Deducting"} <span className="font-medium text-foreground">₱{(centavos / 100).toFixed(2)}</span> {direction === "grant" ? "to" : "from"} {displayName}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="credit-reason">Reason</Label>
        <Input
          id="credit-reason"
          placeholder="Goodwill for the 12 Aug outage"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Recorded against your account, permanently, and shown in the history below.</p>
      </div>

      <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
        {isSubmitting ? "Applying…" : direction === "grant" ? "Grant credit" : "Deduct credit"}
      </Button>
    </form>
  );
}
