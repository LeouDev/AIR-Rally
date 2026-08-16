"use server";

import { revalidatePath } from "next/cache";
import { updateProfile, updateAvatar } from "@/lib/services/profiles";
import { updateProfileSchema, updateAvatarSchema, type UpdateProfileValues } from "@/lib/validations/profile";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Profile } from "@/lib/supabase/types";
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
