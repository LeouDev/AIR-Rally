import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Notification } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Newest first — recent notifications, both read and unread, for the
 * bell's dropdown/inbox. RLS (auth.uid() = user_id or is_admin()) is the
 * real isolation boundary; `userId` here only shapes the query, safe to
 * call from a browser-session client the same way getProfile() already
 * is from AuthNavSection.
 */
export async function listNotifications(supabase: Client, userId: string, limit = 20): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getUnreadCount(supabase: Client, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Scoped by both id and userId — belt-and-suspenders alongside RLS's own
 * "auth.uid() = user_id" update policy, same posture as
 * removeFavorite()/deleteReview() elsewhere in this codebase.
 */
export async function markAsRead(supabase: Client, userId: string, notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

export async function markAllAsRead(supabase: Client, userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}
