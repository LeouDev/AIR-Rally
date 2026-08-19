import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

/**
 * A per-request Supabase client authenticated by a bearer access token
 * instead of cookies — the mobile app's path into the API routes (see
 * app/api/mobile/*). Every PostgREST call carries the user's own JWT, so
 * RLS applies exactly as it does for the cookie-based server client; no
 * session is persisted or refreshed because the token's lifetime is the
 * mobile client's concern.
 *
 * Callers must still verify the token via `client.auth.getUser(token)`
 * before trusting it — construction alone validates nothing.
 */
export function createBearerClient(accessToken: string): SupabaseClient<Database> {
  const { url, anonKey } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
