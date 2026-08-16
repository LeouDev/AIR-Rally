import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingRefund } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * The customer-facing lifecycle bucket for a booking's payment — derived,
 * never stored. "refunded"/"partially_refunded" take priority over the
 * raw booking status because a cancelled-and-refunded booking is more
 * useful to an admin filed under "refunded" than under "cancelled."
 */
export type PaymentLifecycleStatus = "pending" | "confirmed" | "cancelled" | "partially_refunded" | "refunded";

/**
 * Display-only projection of a single booking_refunds row — every field
 * here is either stored verbatim or a straight pass-through, never
 * computed/guessed by this service. platform_refund_amount/
 * venue_refund_amount/refund_basis/provider_available_at are null
 * whenever PayMongo refund execution hasn't actually run for this row
 * (which, with PAYMONGO_REFUND_EXECUTION_ENABLED=false, is always,
 * today) — the admin UI must render that as "not yet known," never as
 * zero or as an inferred value.
 */
export type RefundDetail = {
  id: string;
  status: BookingRefund["status"];
  amount: number;
  refundBasis: BookingRefund["refund_basis"];
  platformRefundAmount: number | null;
  venueRefundAmount: number | null;
  providerAvailableAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type PaymentMonitoringRow = {
  bookingId: string;
  confirmationCode: string;
  createdAt: string;
  paidAt: string | null;
  status: Booking["status"];
  paymentProvider: Booking["payment_provider"];
  priceAmount: number;
  currency: string;
  platformFeeAmount: number | null;
  venueAmount: number | null;
  refundedAmount: number;
  refunds: RefundDetail[];
  lifecycleStatus: PaymentLifecycleStatus;
  reconciliationFlags: string[];
  venueName: string;
  courtName: string;
};

const ABANDONED_PENDING_HOURS = 24;

function deriveLifecycleStatus(booking: Booking, refundedAmount: number): PaymentLifecycleStatus {
  if (refundedAmount > 0 && refundedAmount >= booking.price_amount) return "refunded";
  if (refundedAmount > 0) return "partially_refunded";
  if (booking.status === "cancelled") return "cancelled";
  if (booking.status === "confirmed") return "confirmed";
  return "pending";
}

/**
 * Every flag here is derived from real, already-stored columns — never a
 * guess about provider behavior. See the 13-section production-prep task:
 * "no invented requirements," "no speculative PayMongo behavior as fact."
 */
function deriveReconciliationFlags(booking: Booking, refunds: BookingRefund[], refundedAmount: number): string[] {
  const flags: string[] = [];
  const providerPaymentId = booking.payment_provider === "stripe" ? booking.stripe_payment_intent_id : booking.paymongo_payment_intent_id;

  if (booking.status === "confirmed" && !booking.paid_at) {
    flags.push("Confirmed booking has no paid_at timestamp.");
  }
  if (booking.status === "confirmed" && !providerPaymentId) {
    flags.push("Confirmed booking has no provider payment id on record.");
  }
  if (
    booking.platform_fee_amount != null &&
    booking.venue_amount != null &&
    booking.platform_fee_amount + booking.venue_amount !== booking.price_amount
  ) {
    flags.push("Platform fee + venue amount does not sum to the booking price.");
  }
  if (refundedAmount > booking.price_amount) {
    flags.push("Refunded amount exceeds the booking price.");
  }
  const hasFailedRefund = refunds.some((r) => r.status === "failed");
  const hasSucceededRefund = refunds.some((r) => r.status === "succeeded");
  if (hasFailedRefund && !hasSucceededRefund) {
    flags.push("A refund attempt failed and no later attempt succeeded.");
  }
  if (refunds.some((r) => r.status === "provider_unavailable")) {
    flags.push("A refund cannot be processed through the payment provider — requires manual handling.");
  }
  if (booking.status === "pending") {
    const ageHours = (Date.now() - new Date(booking.created_at).getTime()) / 3_600_000;
    if (ageHours > ABANDONED_PENDING_HOURS) {
      flags.push(`Pending for over ${ABANDONED_PENDING_HOURS}h — likely an abandoned checkout.`);
    }
  }
  return flags;
}

/**
 * Admin-only payment monitoring feed — relies entirely on the existing
 * `bookings`/`booking_refunds` SELECT RLS policies (both already include
 * `is_admin()`), so no service-role key or bypass is needed here; a
 * non-admin caller simply gets an empty/RLS-restricted result rather than
 * this function needing its own authorization logic. Callers (the admin
 * page) still call requireAdmin() first so a non-admin sees a clean
 * "admin-only" message instead of a confusingly empty page.
 */
export async function listPaymentMonitoringRows(supabase: Client, limit = 200): Promise<PaymentMonitoringRow[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, courts(name, venues(name)), booking_refunds(*)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const court = Array.isArray(row.courts) ? row.courts[0] : row.courts;
    const venue = court && (Array.isArray(court.venues) ? court.venues[0] : court.venues);
    const refunds = (Array.isArray(row.booking_refunds) ? row.booking_refunds : []) as BookingRefund[];
    const refundedAmount = refunds.filter((r) => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude joined fields from `booking`
    const { courts: _courts, booking_refunds: _refunds, ...booking } = row;
    const b = booking as Booking;

    return {
      bookingId: b.id,
      confirmationCode: b.confirmation_code,
      createdAt: b.created_at,
      paidAt: b.paid_at,
      status: b.status,
      paymentProvider: b.payment_provider,
      priceAmount: b.price_amount,
      currency: b.currency,
      platformFeeAmount: b.platform_fee_amount,
      venueAmount: b.venue_amount,
      refundedAmount,
      refunds: refunds.map((r) => ({
        id: r.id,
        status: r.status,
        amount: r.amount,
        refundBasis: r.refund_basis,
        platformRefundAmount: r.platform_refund_amount,
        venueRefundAmount: r.venue_refund_amount,
        providerAvailableAt: r.provider_available_at,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
      })),
      lifecycleStatus: deriveLifecycleStatus(b, refundedAmount),
      reconciliationFlags: deriveReconciliationFlags(b, refunds, refundedAmount),
      venueName: venue?.name ?? "Venue",
      courtName: court?.name ?? "Court",
    };
  });
}

export type VenuePaymentIssue = {
  venueId: string;
  venueName: string;
  kind: "not_active" | "paymongo_onboarding";
  detail: string;
};

/**
 * Venue-level issues worth an admin's attention — a venue that can't
 * currently be booked (status) or, for PayMongo venues, one stuck
 * mid-onboarding or declined. "draft" is deliberately excluded: it's the
 * normal state of a venue an owner hasn't submitted yet, not something an
 * admin needs to act on.
 */
export async function listVenuePaymentIssues(supabase: Client): Promise<VenuePaymentIssue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id, name, status, paymongo_activation_status, paymongo_declined_reason");
  if (error) throw error;

  const issues: VenuePaymentIssue[] = [];
  for (const v of data ?? []) {
    if (v.status === "pending_review" || v.status === "suspended") {
      issues.push({
        venueId: v.id,
        venueName: v.name,
        kind: "not_active",
        detail: `Venue status is "${v.status}" — not currently bookable by customers.`,
      });
    }
    if (v.paymongo_activation_status !== "unlinked" && v.paymongo_activation_status !== "activated") {
      const detail =
        v.paymongo_activation_status === "declined"
          ? `PayMongo onboarding declined${v.paymongo_declined_reason ? `: ${v.paymongo_declined_reason}` : "."}`
          : `PayMongo onboarding is "${v.paymongo_activation_status}" — not yet activated.`;
      issues.push({ venueId: v.id, venueName: v.name, kind: "paymongo_onboarding", detail });
    }
  }
  return issues;
}
