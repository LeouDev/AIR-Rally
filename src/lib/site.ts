import { headers } from "next/headers";

/**
 * Best-effort absolute origin for building auth redirect URLs (email
 * confirmation, password reset). Prefers the actual request origin so
 * localhost and every deploy preview work without per-environment config;
 * falls back to NEXT_PUBLIC_SITE_URL, then a hardcoded default.
 */
export async function getSiteUrl(): Promise<string> {
  try {
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    if (origin) return origin;

    const host = requestHeaders.get("host");
    if (host) {
      const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request context (e.g. at build time).
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://airrally.app";
}
