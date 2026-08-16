/**
 * @jest-environment node
 */
import { createCourtBlockAction, deleteCourtBlockAction } from "../courtBlock";
import { getServerClient } from "../auth";
import { createCourtBlock, deleteCourtBlock } from "../../services/courtBlocks";

jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/courtBlocks", () => ({
  createCourtBlock: jest.fn(),
  deleteCourtBlock: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateCourtBlock = createCourtBlock as jest.MockedFunction<typeof createCourtBlock>;
const mockDeleteCourtBlock = deleteCourtBlock as jest.MockedFunction<typeof deleteCourtBlock>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const validBlock = {
  courtId: "223e4567-e89b-12d3-a456-426614174000",
  startTime: "2026-08-22T06:00:00.000Z",
  endTime: "2026-08-22T09:00:00.000Z",
  reason: "Maintenance",
};

describe("createCourtBlockAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockCreateCourtBlock.mockReset();
  });

  it("rejects an end time before the start time before ever contacting Supabase", async () => {
    const result = await createCourtBlockAction({ ...validBlock, endTime: "2026-08-22T05:00:00.000Z" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createCourtBlockAction(validBlock);
    expect(result).toEqual({ success: false, error: "Sign in to block a court." });
    expect(mockCreateCourtBlock).not.toHaveBeenCalled();
  });

  it("creates the block under the authenticated user's own id", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "owner-1" }) });
    mockCreateCourtBlock.mockResolvedValue({
      id: "block-1",
      court_id: validBlock.courtId,
      start_time: validBlock.startTime,
      end_time: validBlock.endTime,
      reason: validBlock.reason,
      created_by: "owner-1",
      created_at: "2026-08-15T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z",
    });

    const result = await createCourtBlockAction(validBlock);

    expect(result.success).toBe(true);
    expect(mockCreateCourtBlock).toHaveBeenCalledWith(expect.anything(), "owner-1", expect.objectContaining({ courtId: validBlock.courtId }));
  });

  it("surfaces an RLS rejection (a court the caller doesn't own) as a friendly error, not a crash", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "not-the-owner" }) });
    mockCreateCourtBlock.mockRejectedValue(Object.assign(new Error("RLS denied"), { code: "42501" }));

    const result = await createCourtBlockAction(validBlock);

    expect(result.success).toBe(false);
  });
});

describe("deleteCourtBlockAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockDeleteCourtBlock.mockReset();
  });

  it("requires an authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await deleteCourtBlockAction("223e4567-e89b-12d3-a456-426614174000");
    expect(result).toEqual({ success: false, error: "Sign in to remove a block." });
    expect(mockDeleteCourtBlock).not.toHaveBeenCalled();
  });

  it("deletes the block by id", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "owner-1" }) });
    mockDeleteCourtBlock.mockResolvedValue(undefined);

    const result = await deleteCourtBlockAction("223e4567-e89b-12d3-a456-426614174000");

    expect(result.success).toBe(true);
    expect(mockDeleteCourtBlock).toHaveBeenCalledWith(expect.anything(), "223e4567-e89b-12d3-a456-426614174000");
  });
});
