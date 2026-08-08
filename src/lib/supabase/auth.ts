import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/profiles";
import type { Profile } from "@/lib/supabase/types";

/**
 * Safe for use in components rendered on every page (e.g. Navbar) — never
 * throws. Returns null both when there's no session AND when Supabase
 * isn't configured at all, so pages that don't otherwise touch Supabase
 * keep working with no env vars set (see .env.example).
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export async function getCurrentUserWithProfile(): Promise<{ user: User; profile: Profile | null } | null> {
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
}
