"use server";

import { revalidatePath } from "next/cache";
import { addFavorite, removeFavorite } from "@/lib/services/favorites";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function toggleFavoriteAction(
  venueId: string,
  currentlyFavorited: boolean
): Promise<ActionResult<{ isFavorited: boolean }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Sign in to save favorites." };
  }

  try {
    if (currentlyFavorited) {
      await removeFavorite(supabase, user.id, venueId);
    } else {
      await addFavorite(supabase, user.id, venueId);
    }
    revalidatePath("/favorites");
    return { success: true, data: { isFavorited: !currentlyFavorited } };
  } catch (error) {
    logServerError("favorites.toggle", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update your favorites.") };
  }
}
