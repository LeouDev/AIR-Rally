/**
 * Centralizes reading the Supabase env vars so every client gets the same
 * clear error instead of a cryptic "Invalid URL" from supabase-js. Only
 * called from within createClient() functions — never at module scope —
 * so pages that don't touch Supabase (landing, explore, court details,
 * all still mock-data-driven) build and run with no env vars configured.
 *
 * Supports both of Supabase's client-safe key formats:
 * - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) — the
 *   current-generation format; preferred when present.
 * - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a JWT) — the legacy format, still
 *   valid and still what older projects' dashboards show. Used as a
 *   fallback so this works regardless of which key type a given Supabase
 *   project has enabled under Settings -> API.
 *
 * Both are meant to be public/client-exposed — that's what NEXT_PUBLIC_
 * means here and why this is safe, unlike a service-role/secret key.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase client key " +
        "(NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
        "Copy .env.example to .env.local and fill in your Supabase project's values " +
        "(Project Settings -> API in the Supabase dashboard)."
    );
  }

  return { url, anonKey: key };
}
