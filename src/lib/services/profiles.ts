import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile, PublicProfile } from "@/lib/supabase/types";
import type { UpdateProfileValues } from "@/lib/validations/profile";

type Client = SupabaseClient<Database>;

/**
 * Any registered user's public-safe profile (display_name/avatar_url
 * only) — for rendering someone else's COURT/Side profile page, where
 * `profiles`' own own-row-only RLS would return nothing.
 */
export async function getPublicProfile(supabase: Client, userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.from("public_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Backs COURT/Side's @mention autocomplete — real registered users only, matched by display name. */
export async function searchPublicProfiles(supabase: Client, query: string, limit = 5): Promise<PublicProfile[]> {
  const term = query.trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .not("display_name", "is", null)
    .ilike("display_name", `%${term}%`)
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getProfile(supabase: Client, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Whether this user gets the email copy of their notifications. Separate
 * from updateProfile() deliberately — a single-purpose toggle, not part
 * of the name/phone/avatar form. Freely updatable under the existing
 * "Users can update their own profile" RLS policy: profiles_prevent_role_
 * change only guards the `role` column, nothing else.
 */
export async function updateEmailNotificationPreference(supabase: Client, userId: string, enabled: boolean): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ email_notifications_enabled: enabled })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: Client,
  userId: string,
  values: UpdateProfileValues
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: values.firstName,
      last_name: values.lastName,
      display_name: values.displayName,
      phone: values.phone || null,
      avatar_url: values.avatarUrl || null,
    })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * A narrow single-field update, separate from `updateProfile()`'s
 * full-form payload — used by the avatar uploader (see
 * AvatarUploadButton.tsx) to persist immediately after a Storage upload
 * completes, without touching name/phone or requiring the rest of the
 * profile form to be filled in and submitted together.
 */
export async function updateAvatar(supabase: Client, userId: string, avatarUrl: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type ProfileStats = {
  tripCount: number;
  reviewCount: number;
  memberSince: string;
};

/**
 * "Trips" counts confirmed bookings only (not pending/cancelled) — the
 * same status a booking must reach for `getReviewEligibility()` to ever
 * consider it reviewable (see lib/services/reviews.ts), so the two
 * numbers stay consistent with each other. Both counts use `head: true`
 * so Postgres never materializes the matching rows, just the count.
 */
export async function getProfileStats(supabase: Client, userId: string, createdAt: string): Promise<ProfileStats> {
  const [tripsResult, reviewsResult] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "confirmed"),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if (tripsResult.error) throw tripsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  return {
    tripCount: tripsResult.count ?? 0,
    reviewCount: reviewsResult.count ?? 0,
    memberSince: createdAt,
  };
}
