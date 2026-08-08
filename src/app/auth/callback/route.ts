import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";

/**
 * Landing point for every Supabase Auth email link (signup confirmation,
 * password recovery). Exchanges the PKCE `code` for a session, then
 * forwards to `next` (defaults to the homepage; password recovery passes
 * `next=/reset-password`).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    logServerError("auth.exchangeCodeForSession", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
