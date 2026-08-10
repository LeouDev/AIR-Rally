import { getAvailableSlots } from "@/lib/services/availability";
import { createRpcMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import { SLOT_INCREMENT_MINUTES, MIN_LEAD_TIME_MINUTES } from "@/lib/booking-config";

describe("getAvailableSlots", () => {
  it("returns the slots the RPC reports, in order", async () => {
    const slots = [
      { slot_start: "2026-08-10T00:00:00Z", slot_end: "2026-08-10T01:00:00Z" },
      { slot_start: "2026-08-10T01:00:00Z", slot_end: "2026-08-10T02:00:00Z" },
    ];
    const supabase = createRpcMockSupabase({ data: slots, error: null });

    await expect(getAvailableSlots(supabase, "court-1", "2026-08-10", 60)).resolves.toEqual(slots);
  });

  it("passes the configured slot increment and lead time from booking-config, not a hardcoded value", async () => {
    const supabase = createRpcMockSupabase({ data: [], error: null });
    await getAvailableSlots(supabase, "court-1", "2026-08-10", 60);

    expect(supabase.rpc).toHaveBeenCalledWith("get_available_slots", {
      p_court_id: "court-1",
      p_local_date: "2026-08-10",
      p_duration_minutes: 60,
      p_increment_minutes: SLOT_INCREMENT_MINUTES,
      p_min_lead_minutes: MIN_LEAD_TIME_MINUTES,
    });
  });

  it("returns an empty array rather than null when the RPC reports no data", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: null });
    await expect(getAvailableSlots(supabase, "court-1", "2026-08-10", 60)).resolves.toEqual([]);
  });

  it("throws when the RPC errors", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: postgrestError("42501", "denied") });
    await expect(getAvailableSlots(supabase, "court-1", "2026-08-10", 60)).rejects.toBeTruthy();
  });
});
