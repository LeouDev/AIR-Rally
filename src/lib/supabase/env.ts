/**
 * Centralizes reading the Supabase env vars so every client gets the same
 * clear error instead of a cryptic "Invalid URL" from supabase-js. Only
 * called from within createClient() functions — never at module scope —
 * so pages that don't touch Supabase (landing, explore, court details,
 * all still mock-data-driven) build and run with no env vars configured.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project's values " +
        "(Project Settings -> API in the Supabase dashboard)."
    );
  }

  return { url, anonKey };
}
