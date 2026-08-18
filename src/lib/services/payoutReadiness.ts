import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { DEFAULT_CURRENCY } from "@/lib/booking-config";
import { getSettlementIssues } from "@/lib/services/settlements";
import { assertRowShape } from "@/lib/postgrestShape";

type Client = SupabaseClient<Database>;

/**
 * Answers one question: can AIR/Rally responsibly pay venues right now?
 *
 * Two independent things have to be true, and they fail for different
 * reasons, so they are reported separately rather than collapsed into a
 * single boolean:
 *
 *   1. The ledger is INTERNALLY CONSISTENT — no missing settlements, no
 *      funding drift, no live entitlement on cancelled bookings. This is
 *      reconcile_settlements()'s job and is not re-implemented here; a
 *      second copy of those rules would be a second thing to keep correct.
 *
 *   2. The platform can AFFORD it. A ledger can be perfectly consistent and
 *      still describe an obligation there is no cash for, because credits
 *      let a venue earn entitlement from a booking that collected nothing.
 *
 * Nothing in this module moves money or changes a settlement.
 */

export type PayoutCashPosition = {
  currency: string;
  /** Sum of venue_amount across payable settlements — the ceiling on a payout run. */
  availablePayableAmount: number;
  /** Entitlement with no cash behind it, as a positive obligation. */
  creditFundedExposure: number;
  /**
   * Cash collected minus cash owed across live settlements. Negative means
   * paying every payable settlement would cost more than those bookings
   * brought in.
   */
  cashPositionTotal: number;
  onHoldAmount: number;
  pendingAmount: number;
  /** Already committed to a live (non-cancelled, non-failed) batch. */
  batchedAmount: number;
};

export type PayoutReadiness = {
  /** True only when the ledger is consistent. Affordability is reported separately. */
  ready: boolean;
  /** Ledger problems that must be resolved before any payout run. */
  blockers: { issue: string; bookingId: string; detail: string }[];
  /**
   * Things an admin must consciously accept rather than fix — chiefly a
   * negative cash position. Deliberately NOT blockers: operating at a
   * negative cash position is a legitimate business decision, and treating
   * it as an error would train people to ignore the warning that matters.
   */
  warnings: string[];
  cash: PayoutCashPosition;
};

function formatPeso(minorUnits: number): string {
  return `₱${(Math.abs(minorUnits) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Admin-only — payout_cash_position() enforces that itself. */
export async function getPayoutReadiness(supabase: Client): Promise<PayoutReadiness> {
  const [issues, { data, error }] = await Promise.all([
    getSettlementIssues(supabase),
    supabase.rpc("payout_cash_position"),
  ]);
  if (error) throw error;

  const raw = Array.isArray(data) ? data[0] : data;
  const cash: PayoutCashPosition = {
    currency: DEFAULT_CURRENCY,
    availablePayableAmount: Number(raw?.available_payable_amount ?? 0),
    creditFundedExposure: Number(raw?.credit_funded_exposure ?? 0),
    cashPositionTotal: Number(raw?.cash_position_total ?? 0),
    onHoldAmount: Number(raw?.on_hold_amount ?? 0),
    pendingAmount: Number(raw?.pending_amount ?? 0),
    batchedAmount: Number(raw?.batched_amount ?? 0),
  };

  const blockers = issues.errors.map((e) => ({ issue: e.issue, bookingId: e.booking_id, detail: e.detail }));

  const warnings: string[] = [];
  if (cash.cashPositionTotal < 0) {
    warnings.push(
      `Live settlements are ${formatPeso(cash.cashPositionTotal)} short in cash — paying them out draws on funds collected from other bookings.`
    );
  }
  if (cash.creditFundedExposure > 0) {
    warnings.push(
      `${formatPeso(cash.creditFundedExposure)} of entitlement was funded by AIR/Rally Credits, so no cash was collected for it at booking time.`
    );
  }
  if (cash.onHoldAmount > 0) {
    warnings.push(`${formatPeso(cash.onHoldAmount)} is on hold and needs manual review before it can be paid.`);
  }

  return { ready: blockers.length === 0, blockers, warnings, cash };
}

export type BatchValidation = {
  valid: boolean;
  /** Settlement ids that may be batched. */
  eligible: string[];
  /** Why each rejected settlement was rejected, keyed by settlement id. */
  rejected: { settlementId: string; reason: string }[];
};

/**
 * Checks a proposed set of settlements BEFORE a batch is created, so an
 * admin sees why something can't be included instead of hitting a raw
 * database error mid-create.
 *
 * This is a courtesy, not the enforcement. The real rules live in
 * enforce_payout_batch_item() on the table itself, and they run again on
 * every insert — so a settlement that becomes ineligible between this check
 * and the create is still rejected. Anything else would be a time-of-check
 * to time-of-use hole in a financial path.
 */
export async function validatePayoutBatch(supabase: Client, settlementIds: string[]): Promise<BatchValidation> {
  if (settlementIds.length === 0) {
    return { valid: false, eligible: [], rejected: [] };
  }

  const unique = [...new Set(settlementIds)];
  const rejected: { settlementId: string; reason: string }[] = [];

  if (unique.length !== settlementIds.length) {
    rejected.push({ settlementId: "—", reason: "The same settlement was selected more than once." });
  }

  const { data: settlements, error } = await supabase
    .from("booking_settlements")
    .select("id, settlement_status")
    .in("id", unique);
  if (error) throw error;

  const byId = new Map((settlements ?? []).map((s) => [s.id, s.settlement_status]));

  const { data: committed, error: committedError } = await supabase
    .from("payout_batch_items")
    .select("settlement_id, payout_batches(batch_reference, status)")
    .in("settlement_id", unique);
  if (committedError) throw committedError;

  type CommittedRow = {
    settlement_id: string;
    payout_batches: { batch_reference: string; status: string } | null;
  };
  const alreadyBatched = new Map<string, string>();
  for (const item of assertRowShape<CommittedRow>(committed ?? [], ["settlement_id"], "committed settlements query")) {
    const batch = item.payout_batches;
    if (batch && batch.status !== "cancelled" && batch.status !== "failed") {
      alreadyBatched.set(item.settlement_id, batch.batch_reference);
    }
  }

  const eligible: string[] = [];
  for (const id of unique) {
    const status = byId.get(id);
    if (!status) {
      rejected.push({ settlementId: id, reason: "Settlement not found." });
    } else if (status !== "payable") {
      rejected.push({
        settlementId: id,
        reason:
          status === "pending"
            ? "Court time has not been delivered yet, so this is not earned."
            : `Settlement is ${status} and cannot be paid.`,
      });
    } else if (alreadyBatched.has(id)) {
      rejected.push({ settlementId: id, reason: `Already in payout batch ${alreadyBatched.get(id)}.` });
    } else {
      eligible.push(id);
    }
  }

  return { valid: rejected.length === 0 && eligible.length > 0, eligible, rejected };
}
