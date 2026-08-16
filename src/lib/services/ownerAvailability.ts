import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type OwnerScheduleSlot = {
  slotStart: string;
  slotEnd: string;
  status: "booked" | "blocked" | "available";
  bookingId: string | null;
  bookingStatus: string | null;
  customerName: string | null;
  blockId: string | null;
  blockReason: string | null;
};

/**
 * The owner-facing day schedule for one court — every candidate slot for
 * the day, labeled. See get_owner_court_schedule() (supabase/migrations/
 * 20260810000017_owner_court_schedule.sql) for why this is a dedicated
 * RPC rather than reusing getAvailableSlots(): that function only ever
 * returns the bookable subset, which is right for a customer's picker
 * but wrong for a calendar that needs to show and explain every slot.
 * Returns an empty array (not an error) for a court the caller doesn't
 * own — the RPC's own ownership check, not a client-side one.
 */
export async function getOwnerCourtSchedule(
  supabase: Client,
  courtId: string,
  localDate: string,
  durationMinutes = 60,
  incrementMinutes = 60
): Promise<OwnerScheduleSlot[]> {
  const { data, error } = await supabase.rpc("get_owner_court_schedule", {
    p_court_id: courtId,
    p_local_date: localDate,
    p_duration_minutes: durationMinutes,
    p_increment_minutes: incrementMinutes,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    status: row.status,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    customerName: row.customer_name,
    blockId: row.block_id,
    blockReason: row.block_reason,
  }));
}
