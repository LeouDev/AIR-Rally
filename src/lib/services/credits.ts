import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditTransaction, Database } from "@/lib/supabase/types";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { CANCELLATION_CREDIT_CUTOFF_HOURS } from "@/lib/booking-config";

type Client = SupabaseClient<Database>;

/**
 * AIR/Rally Credits are internal booking credits. They are not money:
 * they cannot be withdrawn, transferred between users, purchased, or
 * redeemed outside AIR/Rally, and nothing in this module creates a path
 * to any of those.
 *
 * The ledger (`credit_transactions`) is the single source of truth;
 * `user_credit_wallets.balance` is derived from it by a trigger. Reads
 * here go through the caller's own RLS-scoped client. Writes go through
 * the two service_role-only RPCs, because a wallet movement is
 * authorised by *which code* is calling — a server action that already
 * checked the caller — not by any value in the request. See
 * supabase/migrations/20260810000036_air_rally_credits.sql.
 */

/** Reused across calls, same lazy pattern reschedules.ts uses. */
let creditsServiceRoleClient: Client | null = null;
function getCreditsServiceRoleClient(): Client {
  creditsServiceRoleClient ??= createServiceRoleClient();
  return creditsServiceRoleClient;
}

/** Integer minor units (centavos), never a float — same convention as bookings.price_amount. */
export async function getUserCreditBalance(supabase: Client, userId: string): Promise<{ balance: number }> {
  const { data, error } = await supabase.from("user_credit_wallets").select("balance").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  // No wallet row yet simply means no credit has ever moved for this
  // user — a zero balance, not an error.
  return { balance: data?.balance ?? 0 };
}

/** A user's own credit history, newest first. RLS scopes this to the caller. */
export async function listCreditTransactions(supabase: Client, userId: string, limit = 50): Promise<CreditTransaction[]> {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type IssueCreditInput = {
  userId: string;
  /** Integer minor units, must be positive. */
  amount: number;
  transactionType: CreditTransaction["transaction_type"];
  referenceId?: string | null;
  description?: string | null;
};

/**
 * Adds credit. SERVER ONLY — never reachable from a client component.
 * The caller is responsible for authorising the action (an admin check,
 * or a system path such as cancellation compensation); this function
 * deliberately performs no authorisation of its own, exactly like
 * reschedules.ts's service_role RPC calls.
 *
 * Returns the resulting balance.
 */
export async function addCredit(input: IssueCreditInput): Promise<number> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("Credit amount must be a positive whole number of centavos.");
  }

  const { data, error } = await getCreditsServiceRoleClient().rpc("issue_credit", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_transaction_type: input.transactionType,
    p_reference_id: input.referenceId ?? null,
    p_description: input.description ?? null,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Spends credit against a booking. SERVER ONLY.
 *
 * Sufficiency is checked inside the RPC under a `for update` lock on the
 * wallet — not here — so two concurrent checkouts cannot both pass a
 * balance check and overdraw. Throws if the balance is insufficient.
 *
 * Returns the resulting balance.
 */
export async function deductCredit(input: {
  userId: string;
  amount: number;
  bookingId: string;
  description?: string | null;
}): Promise<number> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("Spend amount must be a positive whole number of centavos.");
  }

  const { data, error } = await getCreditsServiceRoleClient().rpc("spend_credit", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_reference_id: input.bookingId,
    p_description: input.description ?? null,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Applies wallet credit to a pending booking. SERVER ONLY.
 *
 * The wallet debit and the booking's credit_amount_applied are written in
 * one database transaction inside the RPC, so the two can never disagree —
 * there is no window in which the wallet has been charged but the booking
 * doesn't know it, or vice versa. Every authorisation check (the booking is
 * this user's, still pending, not already credited, and the amount fits
 * within the price) also lives in the RPC, where a caller cannot skip it.
 *
 * Throws if any of those fail, including an insufficient balance. Returns
 * the resulting balance.
 */
export async function applyCreditToBooking(input: { userId: string; bookingId: string; amount: number }): Promise<number> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("Applied credit must be a positive whole number of centavos.");
  }

  const { data, error } = await getCreditsServiceRoleClient().rpc("apply_credit_to_booking", {
    p_booking_id: input.bookingId,
    p_user_id: input.userId,
    p_amount: input.amount,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Confirms a booking paid entirely from the wallet. SERVER ONLY.
 *
 * These bookings have no PayMongo session, so the webhook — normally the
 * only thing allowed to mark a booking paid — can never confirm them. This
 * is the sole alternative path, and it is deliberately narrow: the RPC
 * confirms only when the applied credit equals the full price, so it can
 * never be used to shortcut a booking that still owes money.
 *
 * Idempotent: returns false if the booking was already confirmed.
 */
export async function confirmCreditOnlyBooking(input: { userId: string; bookingId: string }): Promise<boolean> {
  const { data, error } = await getCreditsServiceRoleClient().rpc("confirm_credit_only_booking", {
    p_booking_id: input.bookingId,
    p_user_id: input.userId,
  });
  if (error) throw error;
  return data ?? false;
}

// --- Cancellation policy ---------------------------------------------------

/** Who or what ended the booking — the input the policy actually turns on. */
export type CancellationCause =
  | "customer"
  | "venue"
  | "venue_unavailable"
  | "system_error"
  | "support_review";

export type CancellationCreditDecision = {
  /** Integer minor units to issue. Zero means no compensation is due. */
  amount: number;
  eligible: boolean;
  /** Plain-language reason, safe to show the customer. */
  reason: string;
};

/**
 * Decides what compensation a cancelled booking earns, in AIR/Rally
 * Credits. Pure — no I/O, no clock of its own — so the policy can be
 * tested exhaustively and a caller can evaluate it against any instant.
 *
 * The policy:
 *   - Customer cancelling at least CANCELLATION_CREDIT_CUTOFF_HOURS
 *     ahead: full credit.
 *   - Customer cancelling inside that window: nothing. They chose the
 *     timing, and the court can no longer realistically be resold.
 *   - Venue cancelled, venue unavailable, or a system/payment error:
 *     full credit regardless of timing. None of these are the customer's
 *     doing, so the cutoff must not apply.
 *   - Support review: full credit, and the caller is expected to have
 *     made that judgement deliberately rather than reaching this branch
 *     by accident.
 */
export function resolveCancellationCredit(params: {
  cause: CancellationCause;
  /** What the customer actually paid, in integer minor units. */
  amountPaid: number;
  startTime: string;
  now: number;
}): CancellationCreditDecision {
  const { cause, amountPaid, startTime, now } = params;

  if (amountPaid <= 0) {
    return { amount: 0, eligible: false, reason: "Nothing was paid for this booking." };
  }

  if (cause !== "customer") {
    const reasons: Record<Exclude<CancellationCause, "customer">, string> = {
      venue: "The venue cancelled this booking, so it is compensated in full.",
      venue_unavailable: "The venue could not honour this booking, so it is compensated in full.",
      system_error: "A system or payment error affected this booking, so it is compensated in full.",
      support_review: "Compensated in full following a support review.",
    };
    return { amount: amountPaid, eligible: true, reason: reasons[cause] };
  }

  const hoursUntilStart = (new Date(startTime).getTime() - now) / 3_600_000;
  if (hoursUntilStart >= CANCELLATION_CREDIT_CUTOFF_HOURS) {
    return {
      amount: amountPaid,
      eligible: true,
      reason: `Cancelled ${CANCELLATION_CREDIT_CUTOFF_HOURS}+ hours ahead, so it is credited in full.`,
    };
  }

  return {
    amount: 0,
    eligible: false,
    reason: `Cancellations within ${CANCELLATION_CREDIT_CUTOFF_HOURS} hours of the start time are not eligible for credit.`,
  };
}

/**
 * Issues cancellation compensation for a booking, applying the policy
 * above. SERVER ONLY. The reusable hook a future cancellation flow calls
 * — cancellation itself is deliberately not rebuilt here.
 *
 * Idempotency is enforced by the caller checking for an existing
 * compensation row for this booking; the pending-booking restore trigger
 * uses the same reference_id/type guard.
 */
export async function issueCancellationCredit(params: {
  userId: string;
  bookingId: string;
  confirmationCode: string;
  cause: CancellationCause;
  amountPaid: number;
  startTime: string;
  now?: number;
}): Promise<CancellationCreditDecision & { issued: boolean }> {
  const decision = resolveCancellationCredit({
    cause: params.cause,
    amountPaid: params.amountPaid,
    startTime: params.startTime,
    now: params.now ?? Date.now(),
  });

  if (!decision.eligible || decision.amount <= 0) {
    return { ...decision, issued: false };
  }

  await addCredit({
    userId: params.userId,
    amount: decision.amount,
    transactionType: "cancellation_compensation",
    referenceId: params.bookingId,
    description: `Credit issued for cancelled booking #${params.confirmationCode}`,
  });

  return { ...decision, issued: true };
}

/**
 * Manually grants (positive) or deducts (negative) credit, as an admin.
 *
 * Takes the CALLER'S client, deliberately — not the service-role client the
 * rest of this module uses. admin_adjust_credit() checks is_admin() inside
 * itself, which resolves auth.uid(); a service-role call carries no
 * auth.uid() and is refused by design. Passing the wrong client here fails
 * closed, which is the direction that matters.
 *
 * Every guard lives in the RPC rather than here: admin-only, non-empty
 * reason, non-zero amount, and a deduction that cannot take the balance
 * below zero. See supabase/migrations/20260810000057.
 *
 * Returns the resulting balance.
 */
export async function adminAdjustCredit(
  supabase: Client,
  input: { userId: string; amount: number; reason: string }
): Promise<number> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error("Adjustment must be a non-zero whole number of centavos.");
  }
  if (!input.reason.trim()) {
    throw new Error("A reason is required for every credit adjustment.");
  }

  const { data, error } = await supabase.rpc("admin_adjust_credit", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_reason: input.reason.trim(),
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Total unspent credit across every wallet, in integer minor units.
 *
 * This is the outstanding LIABILITY. Credits never expire, so it only
 * grows until it is spent, and it needs somewhere visible to live.
 * Admin-only, checked inside the RPC.
 */
export async function getTotalOutstandingCredit(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("admin_total_outstanding_credit");
  if (error) throw error;
  return Number(data ?? 0);
}

/** One user's full ledger, newest first, for an admin. Admin-only, checked inside the RPC. */
export async function listCreditTransactionsAsAdmin(supabase: Client, userId: string, limit = 50): Promise<CreditTransaction[]> {
  const { data, error } = await supabase.rpc("admin_list_credit_transactions", {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as CreditTransaction[];
}

/**
 * How much of a booking a wallet can cover, and what is left for
 * PayMongo. Pure, so checkout never has to trust a client-supplied
 * split — the server recomputes it from the real balance and the real
 * server-side price.
 */
export function splitBookingPayment(params: { priceAmount: number; availableCredit: number }): {
  creditApplied: number;
  amountDue: number;
  fullyCoveredByCredit: boolean;
} {
  const creditApplied = Math.max(0, Math.min(params.availableCredit, params.priceAmount));
  const amountDue = params.priceAmount - creditApplied;
  return { creditApplied, amountDue, fullyCoveredByCredit: amountDue === 0 };
}
