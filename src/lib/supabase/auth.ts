import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/profiles";
import type { Profile } from "@/lib/supabase/types";

/**
 * Safe for use in components rendered on every page (e.g. Navbar) — never
 * throws. Returns null both when there's no session AND when Supabase
 * isn't configured at all, so pages that don't otherwise touch Supabase
 * keep working with no env vars set (see .env.example).
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
});

export const getCurrentUserWithProfile = cache(async function getCurrentUserWithProfile(): Promise<{
  user: User;
  profile: Profile | null;
} | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const profile = await getProfile(supabase, user.id);
    return { user, profile };
  } catch {
    return null;
  }
});

/**
 * The repeated "getCurrentUser() then redirect to /login?redirect=... if
 * signed out" prologue every owner page already wrote inline (see
 * list-your-court/[venueId]/page.tsx) — factored out once a handful of
 * new owner-dashboard pages started about to copy-paste it again.
 * Deliberately just an auth check, not a role check: see the owner
 * dashboard pages' own comments for why a role gate here would be wrong
 * (this page tree is also the public onboarding entry point for a
 * still-`player` visitor).
 */
export async function requireSignedIn(redirectPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }
  return user;
}
