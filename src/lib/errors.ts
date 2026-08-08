/**
 * Translates raw Supabase/Postgres errors into messages safe to show a
 * user. Server actions should log the original error server-side (for
 * debugging) and return only the friendly version to the client — never
 * forward `error.message` from Supabase directly, since it can describe
 * internal schema/constraint details.
 */

type ErrorLike = { message?: string; code?: string; status?: number };

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === "object") return error as ErrorLike;
  return {};
}

const PATTERNS: Array<{ test: (e: ErrorLike) => boolean; message: string }> = [
  {
    test: (e) => /invalid login credentials/i.test(e.message ?? ""),
    message: "That email or password is incorrect.",
  },
  {
    test: (e) => /already registered|user already exists|already exists/i.test(e.message ?? ""),
    message: "An account with that email already exists.",
  },
  {
    test: (e) => /email not confirmed/i.test(e.message ?? ""),
    message: "Please confirm your email before signing in — check your inbox for the confirmation link.",
  },
  {
    test: (e) => /rate limit|too many requests/i.test(e.message ?? ""),
    message: "Too many attempts. Please wait a moment and try again.",
  },
  {
    test: (e) => /jwt expired|invalid refresh token|session (missing|not found)/i.test(e.message ?? ""),
    message: "Your session has expired. Please sign in again.",
  },
  {
    // Postgres unique_violation
    test: (e) => e.code === "23505",
    message: "That already exists.",
  },
  {
    // Postgres foreign_key_violation / not-null / check constraint
    test: (e) => ["23503", "23502", "23514"].includes(e.code ?? ""),
    message: "We couldn't save that — please check the form and try again.",
  },
];

export function getFriendlyErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  const e = asErrorLike(error);
  return PATTERNS.find((p) => p.test(e))?.message ?? fallback;
}

export function logServerError(scope: string, error: unknown) {
  // Centralized so a later phase can swap in real error reporting
  // (Sentry, etc.) in one place instead of every call site.
  console.error(`[${scope}]`, error);
}
