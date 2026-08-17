"use server";

import { revalidatePath } from "next/cache";
import { updateProfile, updateAvatar, updateEmailNotificationPreference, searchPublicProfiles } from "@/lib/services/profiles";
import { updateProfileSchema, updateAvatarSchema, type UpdateProfileValues } from "@/lib/validations/profile";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Profile, PublicProfile } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function updateProfileAction(values: UpdateProfileValues): Promise<ActionResult<Profile>> {
  const parsed = updateProfileSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const profile = await updateProfile(supabase, user.id, parsed.data);
    revalidatePath("/profile");
    return { success: true, data: profile };
  } catch (error) {
    logServerError("profile.update", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update your profile.") };
  }
}

/**
 * Called right after AvatarUploadButton.tsx finishes a direct-to-Storage
 * upload — the upload itself never touches `profiles`, so this is what
 * actually makes the new picture show up anywhere else that reads
 * `avatar_url` (cards, nav, reviews).
 */
export async function updateAvatarAction(avatarUrl: string): Promise<ActionResult<Profile>> {
  const parsed = updateAvatarSchema.safeParse({ avatarUrl });
  if (!parsed.success) {
    return { success: false, error: "That doesn't look like a valid image." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const profile = await updateAvatar(supabase, user.id, parsed.data.avatarUrl);
    revalidatePath("/profile");
    return { success: true, data: profile };
  } catch (error) {
    logServerError("profile.updateAvatar", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save your new photo.") };
  }
}


/** Toggles whether this user gets emailed a copy of their notifications — used in account settings by both customers and venue owners, the same underlying account either way. */
export async function updateEmailNotificationPreferenceAction(enabled: boolean): Promise<ActionResult<Profile>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const profile = await updateEmailNotificationPreference(supabase, user.id, enabled);
    revalidatePath("/profile");
    return { success: true, data: profile };
  } catch (error) {
    logServerError("profile.updateEmailNotificationPreference", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save that preference.") };
  }
}

/**
 * Finds players by display name, for the "who's coming?" picker.
 *
 * Reads public_profiles — the view that exposes only id, display name and
 * avatar — so a name search can never surface an email, phone number, or
 * anything else private. Signed-in callers only: an open people-search on
 * a public endpoint is a scraping target.
 */
export async function searchPlayersAction(query: string): Promise<ActionResult<PublicProfile[]>> {
  const term = query.trim();
  if (term.length < 2) return { success: true, data: [] };

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to find players." };

  try {
    const profiles = await searchPublicProfiles(supabase, term, 8);
    // Never offer the organiser themselves — they're already on the roster.
    return { success: true, data: profiles.filter((p) => p.id !== user.id) };
  } catch (error) {
    logServerError("profile.searchPlayers", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't search for players.") };
  }
}
