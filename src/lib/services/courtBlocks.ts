import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CourtBlockedPeriod } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type CreateCourtBlockInput = {
  courtId: string;
  startTime: string; // ISO instant
  endTime: string; // ISO instant
  reason: string | null;
};

/**
 * Ownership is enforced entirely by court_blocked_periods' own RLS INSERT
 * policy (supabase/migrations/20260810000003_court_blocked_periods.sql —
 * "Venue owners create blocks for their own courts") — a plain,
 * ordinary self-service insert under the caller's own RLS-scoped
 * `supabase`, no RPC needed, same posture as createBooking()'s own
 * self-service insert.
 */
export async function createCourtBlock(supabase: Client, userId: string, input: CreateCourtBlockInput): Promise<CourtBlockedPeriod> {
  const { data, error } = await supabase
    .from("court_blocked_periods")
    .insert({
      court_id: input.courtId,
      start_time: input.startTime,
      end_time: input.endTime,
      reason: input.reason,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** RLS-scoped delete — matches zero rows (and is silently a no-op) for a block the caller doesn't own, same posture as every other owner-scoped delete in this codebase. */
export async function deleteCourtBlock(supabase: Client, blockId: string): Promise<void> {
  const { error } = await supabase.from("court_blocked_periods").delete().eq("id", blockId);
  if (error) throw error;
}

export async function listCourtBlocks(supabase: Client, courtId: string): Promise<CourtBlockedPeriod[]> {
  const { data, error } = await supabase
    .from("court_blocked_periods")
    .select("*")
    .eq("court_id", courtId)
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data;
}
