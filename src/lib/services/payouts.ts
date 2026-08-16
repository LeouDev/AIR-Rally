import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PayoutBatch, PayoutBatchStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Read and lifecycle operations for payout batches — the internal record of
 * an intended payout, never an instruction to move money.
 *
 * NOTHING HERE CALLS PAYMONGO. There is no transfer, no payout, no
 * settlement_status write. Approving a batch records that an admin decided
 * to pay it; the venues are paid by a manual bank transfer outside this
 * system until a verified PayMongo payout capability exists.
 *
 * Authorisation lives in the database. Every RPC below re-checks is_admin()
 * itself, and the tables' RLS restricts reads to admins (plus, for items,
 * the venue owner they concern). The admin gate in the pages is a fast,
 * friendly failure — not the boundary.
 */

export type PayoutCandidate = {
  settlementId: string;
  venueId: string;
  venueName: string;
  bookingId: string;
  confirmationCode: string | null;
  amount: number;
  currency: string;
  settlementSource: string;
};

/** Payable settlements not already committed to a live batch. Admin-only. */
export async function listPayoutCandidates(supabase: Client): Promise<PayoutCandidate[]> {
  const { data, error } = await supabase.rpc("available_settlements_for_payout");
  if (error) throw error;

  const settlements = (data ?? []) as { id: string; venue_id: string; booking_id: string; venue_amount: number; currency: string; settlement_source: string }[];
  if (settlements.length === 0) return [];

  // The RPC returns the settlement rows themselves; names come from a
  // second scoped read rather than being denormalised into the ledger.
  const venueIds = [...new Set(settlements.map((s) => s.venue_id))];
  const bookingIds = settlements.map((s) => s.booking_id);

  const [{ data: venues }, { data: bookings }] = await Promise.all([
    supabase.from("venues").select("id, name").in("id", venueIds),
    supabase.from("bookings").select("id, confirmation_code").in("id", bookingIds),
  ]);

  const venueName = new Map((venues ?? []).map((v) => [v.id, v.name]));
  const code = new Map((bookings ?? []).map((b) => [b.id, b.confirmation_code]));

  return settlements.map((s) => ({
    settlementId: s.id,
    venueId: s.venue_id,
    venueName: venueName.get(s.venue_id) ?? "Unknown venue",
    bookingId: s.booking_id,
    confirmationCode: code.get(s.booking_id) ?? null,
    amount: s.venue_amount,
    currency: s.currency,
    settlementSource: s.settlement_source,
  }));
}

export async function listPayoutBatches(supabase: Client, status?: PayoutBatchStatus): Promise<PayoutBatch[]> {
  let query = supabase.from("payout_batches").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query.limit(100);
  if (error) throw error;
  return data ?? [];
}

export type PayoutBatchDetail = {
  batch: PayoutBatch;
  items: {
    itemId: string;
    settlementId: string;
    venueId: string;
    venueName: string;
    bookingId: string;
    confirmationCode: string | null;
    amount: number;
    currency: string;
  }[];
  /** Distinct venues in this batch — what a payout run would actually transfer to. */
  venueCount: number;
};

export async function getPayoutBatchDetail(supabase: Client, batchId: string): Promise<PayoutBatchDetail | null> {
  const { data: batch, error } = await supabase.from("payout_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) return null;

  const { data: rawItems, error: itemsError } = await supabase
    .from("payout_batch_items")
    .select("id, settlement_id, venue_id, amount, venues(name), booking_settlements(booking_id, currency, bookings(confirmation_code))")
    .eq("payout_batch_id", batchId);
  if (itemsError) throw itemsError;

  const items = ((rawItems ?? []) as unknown as {
    id: string;
    settlement_id: string;
    venue_id: string;
    amount: number;
    venues: { name: string } | null;
    booking_settlements: { booking_id: string; currency: string; bookings: { confirmation_code: string } | null } | null;
  }[]).map((i) => ({
    itemId: i.id,
    settlementId: i.settlement_id,
    venueId: i.venue_id,
    venueName: i.venues?.name ?? "Unknown venue",
    bookingId: i.booking_settlements?.booking_id ?? "",
    confirmationCode: i.booking_settlements?.bookings?.confirmation_code ?? null,
    amount: i.amount,
    currency: i.booking_settlements?.currency ?? "PHP",
  }));

  return { batch, items, venueCount: new Set(items.map((i) => i.venueId)).size };
}

/**
 * Creates a draft batch. Admin-only, enforced inside the RPC. The whole set
 * succeeds or nothing does — a batch missing settlements the admin thought
 * they'd included is worse than no batch.
 */
export async function createPayoutBatch(supabase: Client, settlementIds: string[], notes?: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_payout_batch", {
    p_settlement_ids: settlementIds,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

/**
 * draft/reviewing -> approved. Records an intention to pay.
 *
 * This does NOT move money and does NOT mark any settlement 'settled'.
 * Every settlement in the batch stays 'payable' until a real transfer
 * succeeds, which nothing in this codebase can currently do.
 */
export async function approvePayoutBatch(supabase: Client, batchId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("approve_payout_batch", { p_batch_id: batchId });
  if (error) throw error;
  return data ?? false;
}

/** Cancels a batch, releasing its settlements back into the candidate pool. */
export async function cancelPayoutBatch(supabase: Client, batchId: string, reason?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_payout_batch", { p_batch_id: batchId, p_reason: reason ?? null });
  if (error) throw error;
  return data ?? false;
}

/**
 * Whether a venue owner's settlement is committed to a live batch, keyed by
 * settlement id. RLS restricts this to the caller's own venues, so an owner
 * learns about their own payouts and nobody else's.
 */
export async function getOwnerBatchStatusBySettlement(supabase: Client): Promise<Map<string, { reference: string; status: PayoutBatchStatus }>> {
  const { data, error } = await supabase
    .from("payout_batch_items")
    .select("settlement_id, payout_batches(batch_reference, status)");
  if (error) throw error;

  const result = new Map<string, { reference: string; status: PayoutBatchStatus }>();
  for (const item of (data ?? []) as unknown as {
    settlement_id: string;
    payout_batches: { batch_reference: string; status: PayoutBatchStatus } | null;
  }[]) {
    const batch = item.payout_batches;
    if (batch && batch.status !== "cancelled" && batch.status !== "failed") {
      result.set(item.settlement_id, { reference: batch.batch_reference, status: batch.status });
    }
  }
  return result;
}
