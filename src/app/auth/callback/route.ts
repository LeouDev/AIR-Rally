import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";

/**
 * Landing point for every Supabase Auth email link (signup confirmation,
 * password recovery) AND every OAuth (Google/Facebook) redirect — the
 * same `code` exchange handles both, since PKCE doesn't care which flow
 * produced the code. Exchanges it for a session, then forwards to `next`
 * (defaults to the homepage; password recovery passes `next=/reset-password`).
 *
 * OAuth needs one extra decision this route didn't used to make: Supabase
 * auto-creates-or-signs-in on `signInWithOAuth()`, so there's no separate
 * "signup" step to have already recorded agreement acceptance the way
 * lib/actions/auth.ts's signUp() does before ever sending a confirmation
 * link. A user with no agreement_acceptances row has never actually
 * finished signup — true for a first-time OAuth arrival, and never true
 * for a normal returning email/password user reaching this same route,
 * since that row was written well before their confirmation link existed.
 * Rather than invent a "is this OAuth" flag, this checks the fact that
 * actually matters: has this account completed the one step OAuth can't
 * do for them.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const intendedRole = searchParams.get("intendedRole");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const { count } = await supabase
        .from("agreement_acceptances")
        .select("id", { count: "exact", head: true })
        .eq("user_id", data.user.id);

      if (!count) {
        const params = new URLSearchParams({ complete: "1", next });
        if (intendedRole) params.set("intendedRole", intendedRole);
        return NextResponse.redirect(`${origin}/signup?${params.toString()}`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
    logServerError("auth.exchangeCodeForSession", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
