import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SettlementIssue, SettlementSource, SettlementStatus } from "@/lib/supabase/types";
import { DEFAULT_CURRENCY } from "@/lib/booking-config";
import { assertRowShape } from "@/lib/postgrestShape";

type Client = SupabaseClient<Database>;

/**
 * Read-side of the settlement ledger — what a venue is owed, and what the
 * platform owes in total. Nothing here writes: every settlement row is
 * created and transitioned by database triggers (see
 * supabase/migrations/20260810000039_settlement_ledger.sql), and no client
 * role has INSERT/UPDATE/DELETE on the table at all.
 *
 * Authorisation is RLS's job, not this module's. The table's policy scopes
 * a SELECT to settlements whose venue the caller owns, or everything for
 * an admin — so `listOwnerSettlements` deliberately does NOT filter by
 * owner id. Adding an owner filter here would imply the security came from
 * this code, and would quietly break the day someone calls it with a
 * different client. The admin functions go through requireAdmin() at the
 * page level for a clean early failure, exactly as adminPayments.ts does,
 * with RLS still the real boundary underneath.
 *
 * NO PAYOUT LOGIC LIVES HERE. See "Future payout flow" at the bottom.
 */

export type SettlementRow = {
  settlementId: string;
  bookingId: string;
  confirmationCode: string | null;
  venueId: string;
  venueName: string;
  courtName: string | null;
  /** When the court time is/was scheduled — what the venue actually earned it for. */
  bookingStartTime: string | null;
  /** When the settlement was recorded (booking confirmation). */
  recordedAt: string;
  currency: string;
  grossBookingAmount: number;
  paymongoAmount: number;
  creditAmount: number;
  platformFee: number;
  venueAmount: number;
  cashPosition: number;
  settlementSource: SettlementSource;
  settlementStatus: SettlementStatus;
};

/** The shape PostgREST returns for the embedded select below. */
type SettlementQueryRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  currency: string;
  gross_booking_amount: number;
  paymongo_amount: number;
  credit_amount: number;
  platform_fee: number;
  venue_amount: number;
  cash_position: number;
  settlement_source: SettlementSource;
  settlement_status: SettlementStatus;
  created_at: string;
  venues: { name: string } | null;
  bookings: { confirmation_code: string; start_time: string; courts: { name: string } | null } | null;
};

/**
 * Everything toRow() reads without a `?? fallback` — the fields where a
 * renamed column would silently become `undefined` inside a money total
 * rather than gracefully degrading. `venues`/`bookings` are deliberately
 * excluded: toRow() already treats their absence as legitimate (a
 * settlement whose venue/booking row isn't visible through the embed
 * still shows the money, per its own comment).
 */
const SETTLEMENT_QUERY_KEYS: (keyof SettlementQueryRow)[] = [
  "id",
  "booking_id",
  "venue_id",
  "currency",
  "gross_booking_amount",
  "paymongo_amount",
  "credit_amount",
  "platform_fee",
  "venue_amount",
  "cash_position",
  "settlement_source",
  "settlement_status",
  "created_at",
];

const SETTLEMENT_SELECT =
  "id, booking_id, venue_id, currency, gross_booking_amount, paymongo_amount, credit_amount, platform_fee, venue_amount, cash_position, settlement_source, settlement_status, created_at, venues(name), bookings(confirmation_code, start_time, courts(name))";

function toRow(r: SettlementQueryRow): SettlementRow {
  return {
    settlementId: r.id,
    bookingId: r.booking_id,
    confirmationCode: r.bookings?.confirmation_code ?? null,
    venueId: r.venue_id,
    // A venue whose row isn't visible through the embed still has a real
    // settlement — show the money rather than dropping the line.
    venueName: r.venues?.name ?? "Unknown venue",
    courtName: r.bookings?.courts?.name ?? null,
    bookingStartTime: r.bookings?.start_time ?? null,
    recordedAt: r.created_at,
    currency: r.currency,
    grossBookingAmount: r.gross_booking_amount,
    paymongoAmount: r.paymongo_amount,
    creditAmount: r.credit_amount,
    platformFee: r.platform_fee,
    venueAmount: r.venue_amount,
    cashPosition: r.cash_position,
    settlementSource: r.settlement_source,
    settlementStatus: r.settlement_status,
  };
}

// --- Owner -----------------------------------------------------------------

export type OwnerSettlementSummary = {
  currency: string;
  /** status = pending: booking confirmed, court time not yet delivered. */
  pending: number;
  /** status = payable: court time delivered, entitlement earned. */
  available: number;
  /** status = settled. Always 0 today — no payout writer exists. */
  paid: number;
  pendingCount: number;
  availableCount: number;
  paidCount: number;
};

/**
 * Sums a venue owner's own entitlement by status. RLS restricts the rows
 * to venues this caller owns.
 *
 * Aggregated in JS over the owner's own rows rather than in SQL, matching
 * ownerAnalytics.ts. That is fine at an owner's scale (their own bookings)
 * and keeps the numbers derived from exactly the rows the table below
 * shows, so a card and its table can never disagree.
 */
export async function getOwnerSettlementSummary(supabase: Client): Promise<OwnerSettlementSummary> {
  const { data, error } = await supabase
    .from("booking_settlements")
    .select("venue_amount, settlement_status, currency");
  if (error) throw error;

  const summary: OwnerSettlementSummary = {
    currency: DEFAULT_CURRENCY,
    pending: 0,
    available: 0,
    paid: 0,
    pendingCount: 0,
    availableCount: 0,
    paidCount: 0,
  };

  for (const row of data ?? []) {
    summary.currency = row.currency ?? summary.currency;
    if (row.settlement_status === "pending") {
      summary.pending += row.venue_amount;
      summary.pendingCount += 1;
    } else if (row.settlement_status === "payable") {
      summary.available += row.venue_amount;
      summary.availableCount += 1;
    } else if (row.settlement_status === "settled") {
      summary.paid += row.venue_amount;
      summary.paidCount += 1;
    }
    // 'reversed' and 'on_hold' are deliberately excluded from all three
    // totals: neither is money the owner should expect.
  }

  return summary;
}

/** A venue owner's settlement history, newest first. RLS scopes this to their venues. */
export async function listOwnerSettlements(supabase: Client, limit = 100): Promise<SettlementRow[]> {
  const { data, error } = await supabase
    .from("booking_settlements")
    .select(SETTLEMENT_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return assertRowShape<SettlementQueryRow>(data ?? [], SETTLEMENT_QUERY_KEYS, "settlements query").map(toRow);
}

// --- Admin -----------------------------------------------------------------

export type AdminSettlementSummary = {
  currency: string;
  /** Everything owed to venues that hasn't been paid: pending + payable. */
  totalVenueLiability: number;
  pendingAmount: number;
  pendingCount: number;
  payableAmount: number;
  payableCount: number;
  /**
   * Real cash actually collected through PayMongo on live (pending +
   * payable) settlements — the sum of paymongo_amount, never derived from
   * the other totals. Credit never reaches this figure: a fully
   * credit-covered booking contributes 0, a mixed one contributes only its
   * PayMongo portion. This is the honest counterpart to totalVenueLiability
   * — what's owed vs. what was actually received.
   */
  totalCollectedAmount: number;
  /**
   * The platform's own cash shortfall on unsettled bookings — the sum of
   * every negative cash_position, expressed as a positive number.
   *
   * This is money AIR/Rally owes venues but did NOT collect at booking
   * time, because the customer paid in credits. It is a real future
   * obligation funded from earlier receipts, and it is surfaced rather
   * than netted away deliberately.
   */
  creditFundedExposure: number;
  reversedCount: number;
  /**
   * Real PayMongo cash still held from bookings whose settlement was
   * reversed — sum of paymongo_amount on 'reversed' rows only.
   *
   * A reversal withdraws the VENUE's entitlement; it does not undo the
   * original charge. QR Ph payments cannot be refunded through PayMongo's
   * API, so a cancelled booking's cash was never returned to the customer
   * either. AIR/Rally therefore keeps the entire amount collected — not
   * just its usual platform fee — which is exactly what this figure is.
   *
   * Deliberately excludes 'on_hold' rows: those reverse a SETTLED
   * settlement, meaning the cash already left for the venue, so AIR/Rally
   * does not hold it. Credit-funded reversed bookings correctly contribute
   * 0 here — no real cash was ever collected for the credit portion.
   */
  retainedFromReversedAmount: number;
  onHoldCount: number;
};

/**
 * Platform-wide settlement position. Admin-only at the page level via
 * requireAdmin(); RLS's is_admin() branch is the real boundary.
 *
 * Reads every unsettled row and aggregates in JS. At current volume that
 * is the right trade for numbers that provably match the table beneath
 * them. If the ledger grows past what one request should scan, this is the
 * function to move into a SQL aggregate — not the table to denormalise.
 */
export async function getAdminSettlementSummary(supabase: Client): Promise<AdminSettlementSummary> {
  const { data, error } = await supabase
    .from("booking_settlements")
    .select("venue_amount, paymongo_amount, cash_position, settlement_status, currency");
  if (error) throw error;

  const summary: AdminSettlementSummary = {
    currency: DEFAULT_CURRENCY,
    totalVenueLiability: 0,
    pendingAmount: 0,
    pendingCount: 0,
    payableAmount: 0,
    payableCount: 0,
    totalCollectedAmount: 0,
    creditFundedExposure: 0,
    reversedCount: 0,
    retainedFromReversedAmount: 0,
    onHoldCount: 0,
  };

  for (const row of data ?? []) {
    summary.currency = row.currency ?? summary.currency;

    if (row.settlement_status === "pending") {
      summary.pendingAmount += row.venue_amount;
      summary.pendingCount += 1;
    } else if (row.settlement_status === "payable") {
      summary.payableAmount += row.venue_amount;
      summary.payableCount += 1;
    } else if (row.settlement_status === "reversed") {
      summary.reversedCount += 1;
      summary.retainedFromReversedAmount += row.paymongo_amount;
    } else if (row.settlement_status === "on_hold") {
      summary.onHoldCount += 1;
    }

    // Same scope as the liability figures: live entitlement only. A
    // reversed booking's cash, if any was ever collected, isn't owed to a
    // venue anymore, so it doesn't belong in a "what we owe vs. what we
    // collected" comparison.
    if (row.settlement_status === "pending" || row.settlement_status === "payable") {
      summary.totalCollectedAmount += row.paymongo_amount;
    }

    // Exposure counts only live entitlement. A reversed settlement is no
    // longer owed, so its shortfall is not an obligation.
    if ((row.settlement_status === "pending" || row.settlement_status === "payable") && row.cash_position < 0) {
      summary.creditFundedExposure += -row.cash_position;
    }
  }

  summary.totalVenueLiability = summary.pendingAmount + summary.payableAmount;
  return summary;
}

/** Every settlement, newest first, optionally narrowed to one status. Admin-only. */
export async function listAllSettlements(
  supabase: Client,
  options: { status?: SettlementStatus; limit?: number } = {}
): Promise<SettlementRow[]> {
  let query = supabase.from("booking_settlements").select(SETTLEMENT_SELECT).order("created_at", { ascending: false });
  if (options.status) query = query.eq("settlement_status", options.status);

  const { data, error } = await query.limit(options.limit ?? 200);
  if (error) throw error;
  return assertRowShape<SettlementQueryRow>(data ?? [], SETTLEMENT_QUERY_KEYS, "settlements query").map(toRow);
}

export type SettlementIssueGroups = {
  /** Genuine problems — a payout run must not proceed while any exist. */
  errors: SettlementIssue[];
  /**
   * unfunded_entitlement rows. NOT errors: this is the expected shape of
   * every credit-funded booking. Separated so a normal, healthy ledger
   * doesn't read as broken.
   */
  exposure: SettlementIssue[];
};

/**
 * Runs the database's own reconcile_settlements() and splits its output
 * into real problems and expected credit exposure.
 *
 * The rules live in SQL rather than here on purpose: rules that are only
 * written down in application code don't get checked by anything else.
 */
export async function getSettlementIssues(supabase: Client): Promise<SettlementIssueGroups> {
  const { data, error } = await supabase.rpc("reconcile_settlements");
  if (error) throw error;

  const rows = (data ?? []) as SettlementIssue[];
  return {
    errors: rows.filter((r) => r.issue !== "unfunded_entitlement"),
    exposure: rows.filter((r) => r.issue === "unfunded_entitlement"),
  };
}

// --- Future payout flow (documentation only) -------------------------------
//
// NOTHING BELOW IS IMPLEMENTED. Recorded here so the next phase starts from
// the intended shape rather than reconstructing it.
//
//   settlement_status = 'payable'
//        |  a scheduled sweep (mark_settlements_payable()) has confirmed
//        |  the court time was actually delivered
//        v
//   payout batch
//        |  group payable settlements by venue, one transfer per venue per
//        |  run rather than per booking, and record the batch so a partial
//        |  failure can be resumed instead of replayed
//        v
//   PayMongo transfer
//        |  requires: an activated PayMongo Platforms account per venue
//        |  (none exist today), a verified transfer/payout API, and the
//        |  processing-fee behaviour that is still unconfirmed
//        v
//   settlement_status = 'settled', settled_at = now()
//
// Preconditions before any of that is safe to build:
//   * reconcile_settlements() returns zero `errors` (exposure rows are fine)
//   * creditFundedExposure is funded — the platform must actually hold the
//     cash for credit-funded entitlement before paying it out
//   * a reversal path exists for a transfer that fails after being sent
//
// See SETTLEMENT-LEDGER.md for the full design and what is deliberately
// still missing.
