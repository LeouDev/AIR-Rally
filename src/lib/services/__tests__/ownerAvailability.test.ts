/**
 * @jest-environment node
 */
import { getOwnerCourtSchedule } from "../ownerAvailability";
import { createRpcMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";

describe("getOwnerCourtSchedule", () => {
  it("maps the RPC's snake_case rows to camelCase, and passes real params through", async () => {
    const supabase = createRpcMockSupabase({
      data: [
        {
          slot_start: "2026-08-20T01:00:00Z",
          slot_end: "2026-08-20T02:00:00Z",
          status: "booked",
          booking_id: "booking-1",
          booking_status: "confirmed",
          customer_name: "John",
          block_id: null,
          block_reason: null,
        },
        {
          slot_start: "2026-08-20T02:00:00Z",
          slot_end: "2026-08-20T03:00:00Z",
          status: "blocked",
          booking_id: null,
          booking_status: null,
          customer_name: null,
          block_id: "block-1",
          block_reason: "Maintenance",
        },
      ],
      error: null,
    });

    const result = await getOwnerCourtSchedule(supabase, "court-1", "2026-08-20");

    expect(supabase.rpc).toHaveBeenCalledWith("get_owner_court_schedule", {
      p_court_id: "court-1",
      p_local_date: "2026-08-20",
      p_duration_minutes: 60,
      p_increment_minutes: 60,
    });
    expect(result).toEqual([
      {
        slotStart: "2026-08-20T01:00:00Z",
        slotEnd: "2026-08-20T02:00:00Z",
        status: "booked",
        bookingId: "booking-1",
        bookingStatus: "confirmed",
        customerName: "John",
        blockId: null,
        blockReason: null,
      },
      {
        slotStart: "2026-08-20T02:00:00Z",
        slotEnd: "2026-08-20T03:00:00Z",
        status: "blocked",
        bookingId: null,
        bookingStatus: null,
        customerName: null,
        blockId: "block-1",
        blockReason: "Maintenance",
      },
    ]);
  });

  it("returns an empty array for a court the caller doesn't own (the RPC's own ownership check returns zero rows, not an error)", async () => {
    const supabase = createRpcMockSupabase({ data: [], error: null });
    const result = await getOwnerCourtSchedule(supabase, "someone-elses-court", "2026-08-20");
    expect(result).toEqual([]);
  });

  it("propagates a real database error rather than swallowing it", async () => {
    const supabase = createRpcMockSupabase({ data: null, error: postgrestError("42501") });
    await expect(getOwnerCourtSchedule(supabase, "court-1", "2026-08-20")).rejects.toMatchObject({ code: "42501" });
  });
});
