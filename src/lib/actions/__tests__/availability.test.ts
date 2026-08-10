/**
 * @jest-environment node
 */
import { getAvailableSlotsAction } from "../availability";
import { getServerClient } from "../auth";
import { getAvailableSlots } from "../../services/availability";
import type { AvailableSlot } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/availability", () => ({ getAvailableSlots: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockGetAvailableSlots = getAvailableSlots as jest.MockedFunction<typeof getAvailableSlots>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

const validInput = { courtId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298", localDate: "2026-08-12", durationMinutes: 60 };
const SLOTS: AvailableSlot[] = [{ slot_start: "2026-08-12T00:00:00Z", slot_end: "2026-08-12T01:00:00Z" }];

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockGetAvailableSlots.mockReset();
});

describe("getAvailableSlotsAction", () => {
  it("rejects invalid input before contacting Supabase", async () => {
    const result = await getAvailableSlotsAction({ ...validInput, courtId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("does not require an authenticated session — availability is public marketplace information", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    mockGetAvailableSlots.mockResolvedValue(SLOTS);

    const result = await getAvailableSlotsAction(validInput);

    expect(result).toEqual({ success: true, data: SLOTS });
  });

  it("passes the parsed values straight through to the service", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockGetAvailableSlots.mockResolvedValue(SLOTS);

    await getAvailableSlotsAction(validInput);

    expect(mockGetAvailableSlots).toHaveBeenCalledWith(expect.anything(), validInput.courtId, validInput.localDate, validInput.durationMinutes);
  });

  it("returns a friendly error rather than throwing when the service fails", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    mockGetAvailableSlots.mockRejectedValue(new Error("connection reset"));

    const result = await getAvailableSlotsAction(validInput);

    expect(result).toEqual({ success: false, error: "We couldn't load availability." });
  });
});
