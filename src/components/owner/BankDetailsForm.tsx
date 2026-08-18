"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBankDetailsAction } from "@/lib/actions/bankDetails";
import { bankDetailsSchema } from "@/lib/validations/bankDetails";
import { PESONET_BANKS } from "@/lib/payouts/pesonetBanks";

type BankDetailsFormProps = {
  venueId: string;
  /** Current values, if the owner has set them before. */
  bankName: string | null;
  bankAccountName: string | null;
  /** Masked to the last four digits — the full number is never sent back to the browser. */
  maskedAccountNumber: string | null;
};

type FieldErrors = Partial<Record<"bankName" | "bankAccountName" | "bankAccountNumber", string>>;

/**
 * Where a venue's earnings get sent.
 *
 * The bank is a native <select> over PayMongo's own PESONet list rather
 * than a text field: they match the name character for character when a
 * transfer file is uploaded, so a typo here would surface days later as a
 * failed payout rather than immediately as a form error.
 *
 * The account number starts blank even when one is already saved, and the
 * existing value is shown only as its last four digits. Re-displaying a
 * full account number achieves nothing the owner doesn't already know and
 * puts it into page source and screen-shares.
 */
export function BankDetailsForm({ venueId, bankName, bankAccountName, maskedAccountNumber }: BankDetailsFormProps) {
  const router = useRouter();
  const [bank, setBank] = useState(bankName ?? "");
  const [accountName, setAccountName] = useState(bankAccountName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const parsed = bankDetailsSchema.safeParse({
      bankName: bank,
      bankAccountName: accountName,
      bankAccountNumber: accountNumber,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "bankName" || field === "bankAccountName" || field === "bankAccountNumber") {
          next[field] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setSaving(true);
    const result = await updateBankDetailsAction(venueId, parsed.data);
    setSaving(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Payout details saved.");
    setAccountNumber("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`bank-${venueId}`}>Bank</Label>
        <select
          id={`bank-${venueId}`}
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          aria-invalid={Boolean(errors.bankName)}
          aria-describedby={errors.bankName ? `bank-${venueId}-error` : undefined}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select your bank…</option>
          {PESONET_BANKS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {errors.bankName && (
          <p id={`bank-${venueId}-error`} role="alert" className="text-sm text-destructive">
            {errors.bankName}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`account-name-${venueId}`}>Account name</Label>
        <Input
          id={`account-name-${venueId}`}
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          maxLength={120}
          placeholder="Exactly as it appears on the account"
          aria-invalid={Boolean(errors.bankAccountName)}
          aria-describedby={errors.bankAccountName ? `account-name-${venueId}-error` : undefined}
        />
        {errors.bankAccountName && (
          <p id={`account-name-${venueId}-error`} role="alert" className="text-sm text-destructive">
            {errors.bankAccountName}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`account-number-${venueId}`}>Account number</Label>
        <Input
          id={`account-number-${venueId}`}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          placeholder={maskedAccountNumber ? `Currently ${maskedAccountNumber} — type to replace` : "Digits only"}
          aria-invalid={Boolean(errors.bankAccountNumber)}
          aria-describedby={errors.bankAccountNumber ? `account-number-${venueId}-error` : undefined}
        />
        {errors.bankAccountNumber && (
          <p id={`account-number-${venueId}-error`} role="alert" className="text-sm text-destructive">
            {errors.bankAccountNumber}
          </p>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Landmark className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Transfers go out over PESONet on banking days. Double-check these — a wrong account number sends money to the wrong
        person, and it cannot be recalled.
      </p>

      <Button type="submit" disabled={saving} className="self-start">
        {saving ? "Saving…" : maskedAccountNumber ? "Update payout details" : "Save payout details"}
      </Button>
    </form>
  );
}
