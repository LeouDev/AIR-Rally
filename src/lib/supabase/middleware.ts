import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

const PROTECTED_PREFIXES = ["/profile", "/bookings", "/favorites"];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Refreshes the Supabase session on every request and redirects
 * unauthenticated users away from protected routes, preserving the
 * destination as `?redirect=` so login can send them back afterward.
 *
 * Runs from proxy.ts. If Supabase env vars aren't configured, protected
 * routes are treated as inaccessible (redirect to login) rather than
 * throwing — a misconfigured deployment should fail closed, not open.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = (() => {
    try {
      return getSupabaseEnv();
    } catch {
      return null;
    }
  })();

  if (!env) {
    if (isProtectedPath(request.nextUrl.pathname)) {
      return redirectToLogin(request);
    }
    return response;
  }

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() re-validates the token against Supabase Auth rather than
  // just trusting whatever's in the cookie — required for a security
  // check like this one. Also what actually triggers a token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    return redirectToLogin(request);
  }

  return response;
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  const redirectTarget = `${url.pathname}${url.search}`;
  url.pathname = "/login";
  url.search = "";
  if (redirectTarget && redirectTarget !== "/login") {
    url.searchParams.set("redirect", redirectTarget);
  }
  return NextResponse.redirect(url);
}
