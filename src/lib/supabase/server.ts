import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase client for Server Components, Server Actions, and Route
 * Handlers. Create a new one per request — never share it across requests.
 *
 * Wrapped in React's `cache`, which memoizes PER REQUEST (not globally), so
 * the dozen-odd `createClient()` calls in a single page render — the page,
 * the navbar, the footer, each service — share one client and one cookie
 * read instead of rebuilding it every time. Cross-request sharing is still
 * impossible, which is the part that would be a security problem.
 *
 * Server Components can read cookies but not write them, so `setAll` below
 * is a no-op there (wrapped in try/catch per Supabase's documented
 * pattern). Session refreshes still get persisted correctly because
 * `proxy.ts` runs on every request and writes the refreshed cookies to the
 * response — this client just needs to not crash when it can't.
 */
export const createClient = cache(async function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — proxy.ts handles persisting
          // the refreshed session instead. Safe to ignore here.
        }
      },
    },
  });
});
