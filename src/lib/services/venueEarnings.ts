import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Booking, BookingRefund, BookingStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type VenueEarningsRow = {
  bookingId: string;
  confirmationCode: string;
  courtName: string;
  startTime: string;
  status: BookingStatus;
  paymentProvider: Booking["payment_provider"];
  paidAt: string | null;
  priceAmount: number;
  currency: string;
  platformFeeAmount: number | null;
  venueAmount: number | null;
  refundedAmount: number;
  /**
   * Sum of succeeded refunds' venue_refund_amount for this booking — from
   * PayMongo's own real split_refund response only, never computed
   * locally. Null (not zero) whenever no succeeded refund has actually
   * reported this figure yet, so the UI can distinguish "no refund
   * impact" from "not yet known."
   */
  venueRefundAmount: number | null;
  /** True when this booking was cancelled by a completed reschedule (see lib/services/reschedules.ts) — its slot moved to a replacement booking, never a claim about money already moved. */
  wasRescheduled: boolean;
  /** True when this booking IS a completed reschedule's replacement — its price/venue_amount are its own independent snapshot, not derived from the original it replaced. */
  isRescheduleReplacement: boolean;
};

export type VenueEarningsSummary = {
  currency: string;
  /** Sum of price_amount across confirmed bookings — what customers have paid, never a claim of funds received. */
  grossConfirmed: number;
  refunded: number;
  /**
   * Sum of venue_amount across bookings where it was actually snapshotted
   * (PayMongo marketplace split only — see field doc on Booking.venue_amount).
   * Purely informational: it is the requested split, not a confirmation
   * that PayMongo actually settled/paid out that amount to this venue.
   */
  splitVenueAmount: number;
  rows: VenueEarningsRow[];
};

const DEFAULT_SUMMARY_CURRENCY = "PHP";

/**
 * Owner-facing earnings visibility for a venue's own bookings (see the
 * 13-section production-prep task, section 8). Reuses the existing
 * "Users can view their own bookings" SELECT policy, which already
 * includes venue owners via a courts/venues join (see
 * supabase/migrations/20260810000004_bookings.sql) — no bypass needed.
 *
 * Two separate queries (courts, then bookings), not a courts!inner(...)
 * embed — same reasoning as reviews.ts#getReviewEligibility(): an embed
 * would apply courts' own RLS to the join and could silently drop a real
 * booking at a court that's since gone inactive.
 *
 * IMPORTANT, and the whole reason this doc comment is long: this
 * function surfaces what customers have paid, and — only when actually
 * snapshotted at checkout time (PayMongo marketplace split) — the
 * platform/venue split of that amount. It is NOT a statement that any of
 * it has been paid out/settled to the venue's bank account. Per
 * ARCHITECTURE.md: Stripe Connect payouts were never implemented (every
 * Stripe booking's full amount settles to Air/Rally's own Stripe
 * account, not the venue's), and PayMongo settlement/payout mechanics for
 * Child Merchants remain unverified. The UI consuming this must never
 * describe a booking's amount as "received," "paid out," or "in your
 * account" — only "paid by the customer."
 */
export async function getVenueEarnings(supabase: Client, venueId: string): Promise<VenueEarningsSummary> {
  const { data: courts, error: courtsError } = await supabase.from("courts").select("id, name").eq("venue_id", venueId);
  if (courtsError) throw courtsError;
  if (!courts || courts.length === 0) {
    return { currency: DEFAULT_SUMMARY_CURRENCY, grossConfirmed: 0, refunded: 0, splitVenueAmount: 0, rows: [] };
  }
  const courtNameById = new Map(courts.map((c) => [c.id, c.name]));

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("*, booking_refunds(*)")
    .in(
      "court_id",
      courts.map((c) => c.id)
    )
    .order("start_time", { ascending: false });
  if (bookingsError) throw bookingsError;

  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: rescheduleRows, error: reschedulesError } =
    bookingIds.length > 0
      ? await supabase
          .from("booking_reschedules")
          .select("original_booking_id, new_booking_id, status")
          .or(`original_booking_id.in.(${bookingIds.join(",")}),new_booking_id.in.(${bookingIds.join(",")})`)
      : { data: [], error: null };
  if (reschedulesError) throw reschedulesError;
  const rescheduledOriginals = new Set(
    (rescheduleRows ?? []).filter((r) => r.status === "completed").map((r) => r.original_booking_id)
  );
  const rescheduleReplacements = new Set(
    (rescheduleRows ?? []).filter((r) => r.status === "completed").map((r) => r.new_booking_id)
  );

  let grossConfirmed = 0;
  let refunded = 0;
  let splitVenueAmount = 0;
  let currency = DEFAULT_SUMMARY_CURRENCY;

  const rows: VenueEarningsRow[] = (bookings ?? []).map((row) => {
    const refunds = (Array.isArray(row.booking_refunds) ? row.booking_refunds : []) as BookingRefund[];
    const succeededRefunds = refunds.filter((r) => r.status === "succeeded");
    const refundedAmount = succeededRefunds.reduce((sum, r) => sum + r.amount, 0);
    const knownVenueRefundLegs = succeededRefunds.filter((r) => r.venue_refund_amount != null);
    const venueRefundAmount =
      knownVenueRefundLegs.length > 0 ? knownVenueRefundLegs.reduce((sum, r) => sum + (r.venue_refund_amount ?? 0), 0) : null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude the joined field from `booking`
    const { booking_refunds: _refunds, ...booking } = row;
    const b = booking as Booking;

    currency = b.currency;
    if (b.status === "confirmed") grossConfirmed += b.price_amount;
    refunded += refundedAmount;
    if (b.venue_amount != null) splitVenueAmount += b.venue_amount;

    return {
      bookingId: b.id,
      confirmationCode: b.confirmation_code,
      courtName: courtNameById.get(b.court_id) ?? "Court",
      startTime: b.start_time,
      status: b.status,
      paymentProvider: b.payment_provider,
      paidAt: b.paid_at,
      priceAmount: b.price_amount,
      currency: b.currency,
      platformFeeAmount: b.platform_fee_amount,
      venueAmount: b.venue_amount,
      refundedAmount,
      venueRefundAmount,
      wasRescheduled: rescheduledOriginals.has(b.id),
      isRescheduleReplacement: rescheduleReplacements.has(b.id),
    };
  });

  return { currency, grossConfirmed, refunded, splitVenueAmount, rows };
}
