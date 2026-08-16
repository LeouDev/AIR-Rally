"use server";

import { follow, unfollow } from "@/lib/services/follows";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function toggleFollowAction(
  targetUserId: string,
  currentlyFollowing: boolean
): Promise<ActionResult<{ following: boolean }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to follow players." };
  }
  if (user.id === targetUserId) {
    return { success: false, error: "You can't follow yourself." };
  }

  try {
    if (currentlyFollowing) {
      await unfollow(supabase, user.id, targetUserId);
    } else {
      await follow(supabase, user.id, targetUserId);
    }
    return { success: true, data: { following: !currentlyFollowing } };
  } catch (error) {
    logServerError("follows.toggle", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that.") };
  }
}
