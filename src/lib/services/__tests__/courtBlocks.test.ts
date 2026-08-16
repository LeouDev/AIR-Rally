/**
 * @jest-environment node
 */
import { createCourtBlock, deleteCourtBlock, listCourtBlocks } from "../courtBlocks";
import { createMockSupabase, postgrestError } from "../../test-helpers/mockSupabase";

const BLOCK_ROW = {
  id: "block-1",
  court_id: "court-1",
  start_time: "2026-08-22T06:00:00Z",
  end_time: "2026-08-22T09:00:00Z",
  reason: "Maintenance",
  created_by: "owner-1",
  created_at: "2026-08-15T00:00:00Z",
  updated_at: "2026-08-15T00:00:00Z",
};

describe("createCourtBlock", () => {
  it("inserts with created_by set from the caller, never a client-supplied value", async () => {
    const supabase = createMockSupabase({ data: BLOCK_ROW, error: null });

    const result = await createCourtBlock(supabase, "owner-1", {
      courtId: "court-1",
      startTime: "2026-08-22T06:00:00Z",
      endTime: "2026-08-22T09:00:00Z",
      reason: "Maintenance",
    });

    expect(result).toEqual(BLOCK_ROW);
    const builder = (supabase.from as jest.Mock).mock.results[0].value;
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ court_id: "court-1", created_by: "owner-1", reason: "Maintenance" })
    );
  });

  // RLS (court_blocked_periods' own INSERT policy) is what actually
  // prevents blocking a court the caller doesn't own — this proves the
  // service layer surfaces that rejection cleanly rather than hiding it.
  it("propagates an RLS rejection for a court the caller doesn't own", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501") });
    await expect(
      createCourtBlock(supabase, "not-the-owner", { courtId: "court-1", startTime: "2026-08-22T06:00:00Z", endTime: "2026-08-22T09:00:00Z", reason: null })
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("deleteCourtBlock", () => {
  it("deletes by id, relying on RLS to scope it to the caller's own courts", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await deleteCourtBlock(supabase, "block-1");
    const builder = (supabase.from as jest.Mock).mock.results[0].value;
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "block-1");
  });
});

describe("listCourtBlocks", () => {
  it("lists blocks for a court ordered by start_time", async () => {
    const supabase = createMockSupabase({ data: [BLOCK_ROW], error: null });
    const result = await listCourtBlocks(supabase, "court-1");
    expect(result).toEqual([BLOCK_ROW]);
  });
});
