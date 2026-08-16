/**
 * @jest-environment node
 */
import { markNotificationReadAction, markAllNotificationsReadAction } from "../notifications";
import { getServerClient } from "../auth";
import { markAsRead, markAllAsRead } from "../../services/notifications";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/notifications", () => ({
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockMarkAsRead = markAsRead as jest.MockedFunction<typeof markAsRead>;
const mockMarkAllAsRead = markAllAsRead as jest.MockedFunction<typeof markAllAsRead>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockMarkAsRead.mockReset();
  mockMarkAllAsRead.mockReset();
});

describe("markNotificationReadAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await markNotificationReadAction("notif-1");
    expect(result).toEqual({ success: false, error: "Sign in to view your notifications." });
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  it("marks the notification read for the calling user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockMarkAsRead.mockResolvedValue(undefined);

    const result = await markNotificationReadAction("notif-1");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockMarkAsRead).toHaveBeenCalledWith(expect.anything(), "user-1", "notif-1");
  });

  it("maps a thrown service error to a friendly message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockMarkAsRead.mockRejectedValue(new Error("connection reset"));

    const result = await markNotificationReadAction("notif-1");

    expect(result).toEqual({ success: false, error: "We couldn't update that notification." });
  });
});

describe("markAllNotificationsReadAction", () => {
  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await markAllNotificationsReadAction();
    expect(result).toEqual({ success: false, error: "Sign in to view your notifications." });
    expect(mockMarkAllAsRead).not.toHaveBeenCalled();
  });

  it("marks all notifications read for the calling user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockMarkAllAsRead.mockResolvedValue(undefined);

    const result = await markAllNotificationsReadAction();

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockMarkAllAsRead).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("maps a thrown service error to a friendly message", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockMarkAllAsRead.mockRejectedValue(new Error("connection reset"));

    const result = await markAllNotificationsReadAction();

    expect(result).toEqual({ success: false, error: "We couldn't update your notifications." });
  });
});
