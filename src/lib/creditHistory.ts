import type { CreditTransaction, CreditTransactionType } from "@/lib/supabase/types";

export type CreditHistoryEntry = CreditTransaction & {
  /** Wallet balance immediately AFTER this transaction, in integer minor units. */
  runningBalance: number;
};

/**
 * Attaches a running balance to each ledger row.
 *
 * Anchored to the wallet's own balance and walked BACKWARDS, rather than
 * summed forwards from zero. The wallet balance is maintained by a trigger
 * over the ledger and is the number checkout spends against — so summing the
 * page's 50 rows independently would produce a second calculation that
 * silently disagrees the moment the history is truncated, and a customer
 * would see a running balance that never reaches the balance printed above
 * it.
 *
 * `transactions` must be newest-first, as listCreditTransactions returns
 * them. The newest row's running balance IS the current balance; each older
 * row's is the one after it minus that row's own amount.
 */
export function withRunningBalance(
  transactions: CreditTransaction[],
  currentBalance: number
): CreditHistoryEntry[] {
  let balanceAfter = currentBalance;
  return transactions.map((transaction) => {
    const entry = { ...transaction, runningBalance: balanceAfter };
    balanceAfter -= transaction.amount;
    return entry;
  });
}

const TYPE_LABELS: Record<CreditTransactionType, string> = {
  cancellation_compensation: "Booking cancelled",
  admin_adjustment: "Adjustment",
  promotion_bonus: "Bonus",
  booking_payment: "Paid for a booking",
  account_deletion_forfeiture: "Forfeited on account deletion",
  // Never "Refund" — QR Ph (the only payment method AIR/Rally accepts)
  // cannot be refunded through PayMongo's API at all, so this credit is
  // the actual compensation, not a receipt for one. See the
  // qrph-is-the-only-payment-method memory.
  reschedule_compensation: "Rescheduled to a cheaper court",
};

/**
 * The ledger's own `description` when it has one — it is written at the point
 * the credit was issued and knows more than the type does — falling back to a
 * plain label rather than showing a raw enum.
 */
export function creditEntryLabel(transaction: CreditTransaction): string {
  return transaction.description?.trim() || TYPE_LABELS[transaction.transaction_type];
}

/** Signed, always explicit about direction: "+₱400.00" / "−₱400.00". */
export function formatCreditAmount(amountMinorUnits: number): string {
  const sign = amountMinorUnits < 0 ? "−" : "+";
  return `${sign}₱${(Math.abs(amountMinorUnits) / 100).toFixed(2)}`;
}

export function formatCreditBalance(amountMinorUnits: number): string {
  return `₱${(amountMinorUnits / 100).toFixed(2)}`;
}
