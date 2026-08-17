import { z } from "zod";
import { isPesonetBank } from "@/lib/payouts/pesonetBanks";

/**
 * Mirrors the CHECK constraints in
 * supabase/migrations/20260810000053_venue_bank_details.sql. The database
 * is the boundary; this exists so the form can reject a bad destination
 * before a round trip — and because a rejected PESONet row costs a
 * failed transfer, not just an error message.
 */
export const bankDetailsSchema = z.object({
  bankName: z
    .string()
    .trim()
    .min(1, "Choose your bank")
    // Not a free-text field: PayMongo matches this against their own list
    // character for character, so anything not on it would be rejected at
    // upload time — long after the owner could fix it.
    .refine(isPesonetBank, "Choose a bank from the list"),
  bankAccountName: z
    .string()
    .trim()
    .min(2, "Enter the account name")
    .max(120, "That name is too long")
    // A mismatch between account name and account number is the most
    // common cause of a returned transfer, and the bank is the one that
    // rejects it — days later.
    .refine((v) => /[a-zA-Z]/.test(v), "Enter the name as it appears on the account"),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "Account number should be 6–20 digits, no spaces or dashes"),
});

export type BankDetailsValues = z.infer<typeof bankDetailsSchema>;
