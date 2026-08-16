import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingRefund, RefundBasis } from "@/lib/supabase/types";
import { getSecretKey as getPaymongoSecretKey, PayMongoError, describePayMongoErrorDetail, retrievePayMongoPayment } from "@/lib/services/paymongo";
import { isPaymongoRefundExecutionEnabled } from "@/lib/paymongoLaunchGates";
import { logServerError } from "@/lib/errors";

type Client = SupabaseClient<Database>;

/** Postgres error code for a unique-constraint violation — the real guarantee behind the "one pending refund per booking" index. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * PayMongo has explicitly confirmed (via a real, live TEST MODE API
 * error, not documentation) that it will never refund a payment made via
 * this source type: "Refunds are not allowed for payments with source
 * type qrph." Checked before ever attempting a refund call for a
 * PayMongo booking, so this is a known, recorded outcome
 * ("provider_unavailable") rather than a generic provider failure. See
 * the PayMongo Refund & Cancellation Accounting Design Report.
 */
const REFUND_UNSUPPORTED_SOURCE_TYPES = ["qrph"];

export type RefundErrorReason =
  | "booking_not_found"
  | "booking_not_paid"
  | "amount_exceeds_refundable"
  | "invalid_amount"
  | "paymongo_refund_not_enabled"
  | "provider_call_failed"
  | "refund_already_in_progress";

export class RefundError extends Error {
  constructor(
    public reason: RefundErrorReason,
    message: string
  ) {
    super(message);
    this.name = "RefundError";
  }
}


/**
 * The booking's own stored price minus every refund already marked
 * `succeeded` — recomputed from real state on every call rather than
 * tracked as a separate counter, so a duplicate/retried refund request
 * naturally becomes a no-op (the recomputed refundable amount already
 * reflects any prior success) instead of needing a separate idempotency
 * key.
 */
export async function getRefundableAmount(supabase: Client, booking: Booking): Promise<number> {
  const { data, error } = await supabase.from("booking_refunds").select("amount").eq("booking_id", booking.id).eq("status", "succeeded");
  if (error) throw error;
  const alreadyRefunded = (data ?? []).reduce((sum, r) => sum + r.amount, 0);
  return booking.price_amount - alreadyRefunded;
}

export async function listRefundsForBooking(supabase: Client, bookingId: string): Promise<BookingRefund[]> {
  const { data, error } = await supabase.from("booking_refunds").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Batched variant for a list view (e.g. My Bookings) — one query instead
 * of one per booking. Same RLS as listRefundsForBooking() (a customer
 * only ever sees refunds on their own bookings).
 */
export async function listRefundsForBookings(supabase: Client, bookingIds: string[]): Promise<Map<string, BookingRefund[]>> {
  if (bookingIds.length === 0) return new Map();
  const { data, error } = await supabase.from("booking_refunds").select("*").in("booking_id", bookingIds).order("created_at", { ascending: false });
  if (error) throw error;
  const byBooking = new Map<string, BookingRefund[]>();
  for (const refund of data) {
    const existing = byBooking.get(refund.booking_id) ?? [];
    existing.push(refund);
    byBooking.set(refund.booking_id, existing);
  }
  return byBooking;
}

type RequestRefundParams = {
  booking: Booking;
  amount: number;
  reason: string | null;
  initiatedBy: string;
  /**
   * Which total this specific refund amount was chosen against — a
   * pass-through snapshot of a decision made by the caller, NEVER
   * inferred or defaulted here. There is no approved AIR/Rally business
   * rule yet (see the PayMongo Refund & Cancellation Accounting Design
   * Report's Option A/B/C/D analysis); omitting this leaves it null,
   * exactly as it should stay until that decision is made.
   */
  refundBasis?: RefundBasis;
};

/**
 * The one orchestration entry point — server-side only, never directly
 * reachable by a customer's own request. Two trusted call sites, each
 * responsible for passing a `supabase` client whose privileges are
 * already appropriate for the caller: `lib/actions/refund.ts`'s
 * `refundBookingAction` (admin-gated Server Action — passes the admin's
 * own RLS-scoped session client, which `booking_refunds`' admin-only
 * insert/update policies already permit) and
 * `lib/services/reschedules.ts`'s price-decrease branch of
 * `createReschedule()` (customer-initiated — passes the reschedule
 * module's own narrowly-scoped service-role client, see the production-
 * readiness audit's finding "Blocker A", since an ordinary customer
 * session can never satisfy `booking_refunds`' admin-only insert policy,
 * even for a refund on their own booking that this module has already
 * independently verified they're entitled to).
 *
 * Verifies the payment actually belongs to this booking, verifies the
 * requested amount never exceeds what's actually still refundable,
 * writes a `pending` audit row *before* ever calling the provider (so a
 * crash mid-call still leaves a durable record of the attempt), then
 * calls the real provider and updates the row to `succeeded`/`failed`.
 *
 * PayMongo execution is hard-gated behind
 * isPaymongoRefundExecutionEnabled() — see lib/paymongoLaunchGates.ts —
 * because the two-party split-refund accounting (does the venue's 95%
 * get reversed, does AIR/Rally's 5% get reversed, what happens to
 * PayMongo's own fee) is unproven. Stripe refunds are a plain, standard
 * Stripe API call with no marketplace-splitting complexity in this app
 * (Stripe Connect was never implemented — see ARCHITECTURE.md's paused
 * Phase 4B.5), so Stripe execution is real, not gated.
 */
export async function requestRefund(supabase: Client, params: RequestRefundParams): Promise<BookingRefund> {
  const { booking, amount, reason, initiatedBy, refundBasis } = params;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RefundError("invalid_amount", "Refund amount must be a positive whole number of minor units.");
  }
  if (booking.status !== "confirmed" && booking.status !== "cancelled") {
    // A refund only ever makes sense for a booking that was actually
    // paid (confirmed) — including one since cancelled, which is a real,
    // expected sequence (cancel first, refund manually after).
    throw new RefundError("booking_not_paid", "This booking was never paid, so there's nothing to refund.");
  }

  const providerPaymentId = booking.paymongo_payment_intent_id;
  if (!providerPaymentId) {
    throw new RefundError("booking_not_paid", "This booking has no recorded payment to refund.");
  }

  const refundable = await getRefundableAmount(supabase, booking);
  if (amount > refundable) {
    throw new RefundError(
      "amount_exceeds_refundable",
      `Only ${refundable} of ${booking.currency} minor units remains refundable on this booking.`
    );
  }

  if (!isPaymongoRefundExecutionEnabled()) {
    throw new RefundError(
      "paymongo_refund_not_enabled",
      "PayMongo refund execution is disabled — the two-party split-refund accounting is unverified. See ARCHITECTURE.md / the PayMongo Final Verification Report."
    );
  }

  const { data: pendingRecord, error: insertError } = await supabase
    .from("booking_refunds")
    .insert({
      booking_id: booking.id,
      payment_provider: "paymongo",
      provider_payment_id: providerPaymentId,
      amount,
      currency: booking.currency,
      status: "pending",
      reason,
      initiated_by: initiatedBy,
      refund_basis: refundBasis ?? null,
    })
    .select("*")
    .single();
  if (insertError) {
    // The DB-enforced "one pending refund per booking" guarantee (see
    // supabase/migrations/20260810000014_paymongo_refund_accounting_
    // scaffolding.sql) — the real protection against two concurrent
    // requests both passing the application-level refundable-amount
    // check before either writes its row. Mapped to a clean, typed error
    // rather than ever surfacing the raw 23505 to a caller.
    if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new RefundError("refund_already_in_progress", "A refund is already in progress for this booking.");
    }
    throw insertError;
  }

  try {
    // PayMongo has confirmed certain payment methods can never be
    // refunded through its API at all (QR Ph, confirmed live — see the
    // module-level doc comment). Checked after the pending row exists
    // (so the attempt is durably recorded) but before the refund
    // endpoint — a permanent limitation, so it gets its own terminal
    // status rather than "failed". Inside this try deliberately: a
    // TRANSIENT failure of the detection call itself must also land the
    // row in "failed" rather than escaping as a raw throw with the
    // pending row left dangling.
    const paymentDetail = await retrievePayMongoPayment(providerPaymentId);
    const sourceType = paymentDetail.attributes.source?.type;
    if (sourceType && REFUND_UNSUPPORTED_SOURCE_TYPES.includes(sourceType)) {
      const { data: unavailable, error: updateError } = await supabase
        .from("booking_refunds")
        .update({
          status: "provider_unavailable",
          failure_reason: `PayMongo does not support refunds for "${sourceType}" payments. This booking requires a manual refund handled outside PayMongo — see the admin payment page.`,
        })
        .eq("id", pendingRecord.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return unavailable;
    }

    const result = await executePaymongoRefund(providerPaymentId, amount);

    const { data: succeeded, error: updateError } = await supabase
      .from("booking_refunds")
      .update({
        status: "succeeded",
        provider_refund_id: result.providerRefundId,
        platform_refund_amount: result.platformRefundAmount,
        venue_refund_amount: result.venueRefundAmount,
        provider_available_at: result.providerAvailableAt,
      })
      .eq("id", pendingRecord.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return succeeded;
  } catch (error) {
    logServerError("refunds.providerCallFailed", error);
    const failureReason = error instanceof Error ? error.message : "Unknown provider error";
    const { data: failed, error: updateError } = await supabase
      .from("booking_refunds")
      .update({ status: "failed", failure_reason: failureReason })
      .eq("id", pendingRecord.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return failed;
  }
}

/**
 * The common shape both provider execution functions return, so
 * requestRefund() never needs a runtime type check to decide what to
 * write. Stripe never splits payments in this app (no Stripe Connect —
 * see ARCHITECTURE.md's paused Phase 4B.5), so its three split-specific
 * fields are always null, never guessed.
 */
type RefundExecutionResult = {
  providerRefundId: string;
  platformRefundAmount: number | null;
  venueRefundAmount: number | null;
  providerAvailableAt: string | null;
};


type PayMongoRefundResponse = {
  data?: {
    id: string;
    attributes: {
      available_at?: number | null;
      split_refund?: {
        split_refunds: Array<{ attributes: { amount: number; recipient_organization_id: string } }>;
      } | null;
    };
  };
  errors?: Array<{ detail: unknown }>;
};

/**
 * Confirmed real endpoint/shape (POST /v1/refunds) from this project's
 * own live PayMongo TEST MODE research — see ARCHITECTURE.md. Only ever
 * reachable when isPaymongoRefundExecutionEnabled() is true, checked by
 * the caller (requestRefund) before this function is invoked at all.
 *
 * platformRefundAmount/venueRefundAmount are read verbatim from the real
 * split_refund response's two legs, identified by comparing each leg's
 * recipient_organization_id against PAYMONGO_PLATFORM_ACCOUNT_ID —
 * NEVER computed from AIR/Rally's own 5%/95% commission formula (see
 * the PayMongo Refund & Cancellation Accounting Design Report — that
 * formula does not correctly predict a refund's actual split, only the
 * original payment's). If the platform account id isn't configured, or
 * no split_refund is present on the response (e.g. this payment was
 * never actually split), both stay null rather than guessing.
 */
async function executePaymongoRefund(paymentId: string, amount: number): Promise<RefundExecutionResult> {
  const secretKey = getPaymongoSecretKey();
  const response = await fetch("https://api.paymongo.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { attributes: { amount, payment_id: paymentId, reason: "others" } } }),
  });
  const json = (await response.json()) as PayMongoRefundResponse;
  if (!response.ok || !json.data) {
    throw new PayMongoError(
      "checkout_session_creation_failed",
      describePayMongoErrorDetail(json.errors?.[0]?.detail) ?? `PayMongo refund API returned ${response.status}`
    );
  }

  const platformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
  let platformRefundAmount: number | null = null;
  let venueRefundAmount: number | null = null;
  if (platformAccountId) {
    for (const leg of json.data.attributes.split_refund?.split_refunds ?? []) {
      if (leg.attributes.recipient_organization_id === platformAccountId) {
        platformRefundAmount = leg.attributes.amount;
      } else {
        venueRefundAmount = leg.attributes.amount;
      }
    }
  }

  const availableAt = json.data.attributes.available_at;
  return {
    providerRefundId: json.data.id,
    platformRefundAmount,
    venueRefundAmount,
    providerAvailableAt: availableAt != null ? new Date(availableAt * 1000).toISOString() : null,
  };
}

/**
 * Pure, precisely-defined candidates for a future refund_basis decision
 * (see the PayMongo Refund & Cancellation Accounting Design Report's
 * Option A/B/C/D analysis) — deliberately NOT called anywhere in
 * requestRefund() above. `gross_only` mirrors the original payment's
 * split exactly (proven, by construction, to sum to the original
 * platform/venue shares with zero discrepancy); `gross_plus_fee`
 * matches PayMongo's raw observed refund behavior (proven to debit
 * platform/venue proportionally for the customer's processing fee, in
 * excess of what either party actually received). Exported only so a
 * future, explicitly-approved caller has a ready, tested place to start
 * from — never invoked implicitly, never defaulted.
 */
export function calculateRefundTotal(basis: RefundBasis, bookingGrossAmount: number, customerTotalPaid: number): number {
  return basis === "gross_only" ? bookingGrossAmount : customerTotalPaid;
}
