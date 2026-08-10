import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AvailableSlot } from "@/lib/supabase/types";
import { SLOT_INCREMENT_MINUTES, MIN_LEAD_TIME_MINUTES } from "@/lib/booking-config";

type Client = SupabaseClient<Database>;

/**
 * Bookable (start, end) intervals for one court on one local calendar
 * date, computed entirely inside Postgres (get_available_slots — see
 * supabase/migrations/20260810000005_availability_functions.sql) rather
 * than fetched-and-filtered here. This keeps the query scoped to exactly
 * the relevant court/date window and reuses the same range-overlap
 * semantics the database's own double-booking constraint uses, so a slot
 * this returns is provably insertable, not just probably.
 *
 * `localDate` is a plain "YYYY-MM-DD" — interpreted against the venue's
 * own timezone inside the SQL function, not the caller's.
 */
export async function getAvailableSlots(
  supabase: Client,
  courtId: string,
  localDate: string,
  durationMinutes: number
): Promise<AvailableSlot[]> {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_court_id: courtId,
    p_local_date: localDate,
    p_duration_minutes: durationMinutes,
    p_increment_minutes: SLOT_INCREMENT_MINUTES,
    p_min_lead_minutes: MIN_LEAD_TIME_MINUTES,
  });
  if (error) throw error;
  return data ?? [];
}
