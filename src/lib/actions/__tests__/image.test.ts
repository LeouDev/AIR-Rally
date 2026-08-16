/**
 * @jest-environment node
 */
import { deleteImageAction } from "../image";
import { getServerClient } from "../auth";
import { deleteCourtImage } from "../../services/images";

jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/images", () => ({ deleteCourtImage: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockDeleteCourtImage = deleteCourtImage as jest.MockedFunction<typeof deleteCourtImage>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

describe("deleteImageAction", () => {
  beforeEach(() => {
    mockGetServerClient.mockReset();
    mockDeleteCourtImage.mockReset();
  });

  it("rejects a malformed image id before ever contacting Supabase", async () => {
    const result = await deleteImageAction("not-a-uuid", "venue-1");
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await deleteImageAction("223e4567-e89b-12d3-a456-426614174000", "venue-1");
    expect(result).toEqual({ success: false, error: "Your session has expired. Please sign in again." });
    expect(mockDeleteCourtImage).not.toHaveBeenCalled();
  });

  it("deletes the image by id", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "owner-1" }) });
    mockDeleteCourtImage.mockResolvedValue(undefined);

    const result = await deleteImageAction("223e4567-e89b-12d3-a456-426614174000", "venue-1");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockDeleteCourtImage).toHaveBeenCalledWith(expect.anything(), "223e4567-e89b-12d3-a456-426614174000");
  });

  it("surfaces an RLS rejection (an image belonging to someone else's venue) as a friendly error, not a crash", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "not-the-owner" }) });
    mockDeleteCourtImage.mockRejectedValue(Object.assign(new Error("RLS denied"), { code: "42501" }));

    const result = await deleteImageAction("223e4567-e89b-12d3-a456-426614174000", "venue-1");

    expect(result.success).toBe(false);
  });
});
