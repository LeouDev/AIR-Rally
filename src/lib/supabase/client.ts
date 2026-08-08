import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase client for Client Components. Create a fresh one per component
 * (cheap — it just wraps fetch/cookie access) rather than sharing a module
 * singleton across renders.
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
