import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildContentSecurityPolicy, STATIC_SECURITY_HEADERS } from "@/lib/security/csp";

/**
 * A fresh nonce per request. Must be unpredictable — an attacker who can
 * guess it can inject a script that satisfies the policy.
 */
function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({ nonce, isDev: process.env.NODE_ENV === "development" });

  // updateSession owns the response because it may rewrite cookies or
  // return a redirect for a protected route. The nonce goes in as a
  // REQUEST header so Next can stamp it onto the scripts it renders, and
  // the CSP goes on the response it hands back — including redirects,
  // which is why this is applied after rather than instead.
  const response = await updateSession(request, { nonce, csp });

  response.headers.set("Content-Security-Policy", csp);
  for (const { key, value } of STATIC_SECURITY_HEADERS) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and image optimization
     * requests, so auth cookies stay fresh across normal navigation
     * without proxy paying to re-run on every CSS/JS/image fetch.
     *
     * Those excluded paths therefore carry no CSP, which is correct: a
     * stylesheet or an optimized image has no script to constrain, and the
     * documents that reference them are covered.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)",
  ],
};
