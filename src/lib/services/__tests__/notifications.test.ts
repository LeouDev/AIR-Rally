import { listNotifications, getUnreadCount, markAsRead, markAllAsRead } from "@/lib/services/notifications";
import { createMockSupabase } from "@/lib/test-helpers/mockSupabase";
import type { Notification } from "@/lib/supabase/types";

const NOTIFICATION: Notification = {
  id: "notif-1",
  user_id: "user-1",
  type: "booking_confirmed",
  title: "Booking confirmed",
  message: "Your booking (confirmation #ABC123) is confirmed.",
  read_at: null,
  link_url: null,
  created_at: "2026-08-12T00:00:00Z",
};

describe("listNotifications", () => {
  it("returns the caller's notifications", async () => {
    const supabase = createMockSupabase({ data: [NOTIFICATION], error: null });
    await expect(listNotifications(supabase, "user-1")).resolves.toEqual([NOTIFICATION]);
  });
});

describe("getUnreadCount", () => {
  it("returns the count of unread notifications", async () => {
    const supabase = createMockSupabase({ data: null, error: null, count: 3 });
    await expect(getUnreadCount(supabase, "user-1")).resolves.toBe(3);
  });

  it("returns 0 when count is null", async () => {
    const supabase = createMockSupabase({ data: null, error: null, count: null });
    await expect(getUnreadCount(supabase, "user-1")).resolves.toBe(0);
  });
});

describe("markAsRead", () => {
  it("resolves without error on a successful update", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(markAsRead(supabase, "user-1", "notif-1")).resolves.toBeUndefined();
  });
});

describe("markAllAsRead", () => {
  it("resolves without error on a successful update", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(markAllAsRead(supabase, "user-1")).resolves.toBeUndefined();
  });
});
