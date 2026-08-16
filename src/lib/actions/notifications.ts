"use server";

import { markAsRead, markAllAsRead } from "@/lib/services/notifications";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to view your notifications." };
  }

  try {
    await markAsRead(supabase, user.id, notificationId);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("notifications.markRead", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that notification.") };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to view your notifications." };
  }

  try {
    await markAllAsRead(supabase, user.id);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("notifications.markAllRead", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update your notifications.") };
  }
}
