import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type AdminCheckResult = { ok: true; userId: string } | { ok: false; error: string };

/**
 * Shared admin-gate check reused by every admin-only action/page (refunds,
 * payment monitoring, ...) so the rule can't drift between call sites.
 * RLS's own is_admin() is still the real enforcement underneath — this
 * exists to fail fast with a clean message before ever attempting a
 * privileged read/write, same reasoning as lib/actions/refund.ts already
 * had inline before this was extracted.
 */
export async function requireAdmin(supabase: Client): Promise<AdminCheckResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (error || profile?.role !== "admin") {
    return { ok: false, error: "This area is admin-only." };
  }

  return { ok: true, userId: user.id };
}
