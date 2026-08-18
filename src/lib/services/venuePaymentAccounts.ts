import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, VenuePaymentAccount, VenuePaymentAccountStatus } from "@/lib/supabase/types";
import { assertRowShape } from "@/lib/postgrestShape";

type Client = SupabaseClient<Database>;

/**
 * Venue payout readiness — whether AIR/Rally will pay a venue.
 *
 * Distinct from venues.paymongo_activation_status, which is what PayMongo
 * says about the merchant and governs whether a CHECKOUT can be split. The
 * PayMongo facts are mirrored into these rows by a database trigger and are
 * never written here; the only independently-owned state is an admin's
 * restrict/disable decision. See
 * supabase/migrations/20260810000043_venue_payment_accounts.sql.
 *
 * Nothing in this module moves money.
 */

export type VenuePaymentAccountRow = VenuePaymentAccount & {
  venueName: string;
  ownerName: string | null;
};

/** The caller's own venues' payout readiness. RLS scopes this to them. */
export async function listOwnerPaymentAccounts(supabase: Client): Promise<(VenuePaymentAccount & { venueName: string })[]> {
  const { data, error } = await supabase
    .from("venue_payment_accounts")
    .select("*, venues(name)")
    .order("created_at", { ascending: true });
  if (error) throw error;

  type OwnerAccountRow = VenuePaymentAccount & { venues: { name: string } | null };
  return assertRowShape<OwnerAccountRow>(
    data ?? [],
    ["id", "venue_id", "status", "bank_name", "bank_account_number"],
    "owner payment accounts query"
  ).map((row) => ({
    ...row,
    venueName: row.venues?.name ?? "Unknown venue",
  }));
}

/**
 * Sets where a venue's earnings should be sent.
 *
 * Deliberately updates by venue_id and lets RLS decide whether this caller
 * owns it — no ownership check here, matching the rest of the service
 * layer. The column-level GRANT means only the bank fields can move even
 * if this function were passed something else, and the guard trigger
 * reverts protected columns regardless (migration 20260810000053).
 *
 * `bank_details_updated_at` is stamped here rather than by a trigger so
 * the value reflects when the OWNER last confirmed their details, which is
 * what matters when a transfer bounces and someone asks how current these
 * were.
 */
export async function updateVenueBankDetails(
  supabase: Client,
  venueId: string,
  details: { bankName: string; bankAccountName: string; bankAccountNumber: string }
): Promise<void> {
  const { error } = await supabase
    .from("venue_payment_accounts")
    .update({
      bank_name: details.bankName,
      bank_account_name: details.bankAccountName,
      bank_account_number: details.bankAccountNumber,
      bank_details_updated_at: new Date().toISOString(),
    })
    .eq("venue_id", venueId);
  if (error) throw error;
}

/** True when a venue has a complete destination and could appear in a payout run. */
export function hasBankDetails(account: Pick<VenuePaymentAccount, "bank_name" | "bank_account_number">): boolean {
  return Boolean(account.bank_name && account.bank_account_number);
}

/**
 * Last four digits only, for display back to the owner.
 *
 * A full account number never needs to be re-shown: the owner already
 * knows it, and rendering it puts it in page source, screenshots and
 * support screen-shares for no benefit.
 */
export function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber || accountNumber.length < 4) return null;
  return `••••${accountNumber.slice(-4)}`;
}

/** Every venue's payout readiness, optionally narrowed to one status. Admin-only via RLS. */
export async function listAllPaymentAccounts(
  supabase: Client,
  status?: VenuePaymentAccountStatus
): Promise<VenuePaymentAccountRow[]> {
  let query = supabase
    .from("venue_payment_accounts")
    .select("*, venues(name, owner_id, profiles:owner_id(display_name))")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query.limit(200);
  if (error) throw error;

  type AdminAccountRow = VenuePaymentAccount & {
    venues: { name: string; owner_id: string; profiles: { display_name: string | null } | null } | null;
  };
  return assertRowShape<AdminAccountRow>(
    data ?? [],
    ["id", "venue_id", "status", "bank_name", "bank_account_number"],
    "admin payment accounts query"
  ).map((row) => ({
    ...row,
    venueName: row.venues?.name ?? "Unknown venue",
    ownerName: row.venues?.profiles?.display_name ?? null,
  }));
}

export type VenuePayoutReadiness = {
  venuesReady: number;
  venuesMissingSetup: number;
  venuesRestricted: number;
  /** Earned money that cannot be paid because the venue can't receive it. */
  blockedSettlementAmount: number;
  blockedSettlementCount: number;
};

/** Admin-only — the RPC enforces that itself. */
export async function getVenuePayoutReadiness(supabase: Client): Promise<VenuePayoutReadiness> {
  const { data, error } = await supabase.rpc("venue_payout_readiness");
  if (error) throw error;

  const raw = Array.isArray(data) ? data[0] : data;
  return {
    venuesReady: Number(raw?.venues_ready ?? 0),
    venuesMissingSetup: Number(raw?.venues_missing_setup ?? 0),
    venuesRestricted: Number(raw?.venues_restricted ?? 0),
    blockedSettlementAmount: Number(raw?.blocked_settlement_amount ?? 0),
    blockedSettlementCount: Number(raw?.blocked_settlement_count ?? 0),
  };
}

/**
 * Admin-only status change. Only verified / restricted / disabled are
 * accepted: not_connected and pending_verification describe what PayMongo
 * reports, so they belong to the mirror trigger, not to an admin's opinion.
 */
export async function setVenuePaymentAccountStatus(
  supabase: Client,
  venueId: string,
  status: Extract<VenuePaymentAccountStatus, "verified" | "restricted" | "disabled">,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_venue_payment_account_status", {
    p_venue_id: venueId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data ?? false;
}

/** Owner-facing copy for each state. Kept here so the UI never invents its own wording. */
export function describePaymentAccountStatus(status: VenuePaymentAccountStatus): { title: string; detail: string } {
  switch (status) {
    case "verified":
      return {
        title: "Payment account ready",
        detail: "Your PayMongo account is connected and verified. Earnings from your bookings can be paid out to it.",
      };
    case "pending_verification":
      return {
        title: "Verification in progress",
        detail: "Your PayMongo account is being reviewed. Nothing is needed from you while this is in progress.",
      };
    case "restricted":
      return {
        title: "Payment setup needs attention",
        detail: "Your payment account can't receive payouts right now. Contact support to find out what's needed.",
      };
    case "disabled":
      return {
        title: "Payment account disabled",
        detail: "Payouts to this venue are switched off. Contact support if you think this is a mistake.",
      };
    default:
      return {
        title: "Not connected",
        detail: "Connect a PayMongo account so AIR/Rally can pay out what you earn from bookings.",
      };
  }
}
