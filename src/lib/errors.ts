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
  {
    // Postgres insufficient_privilege — most commonly an RLS policy
    // rejecting the write outright (e.g. a still-'player' account
    // hitting createVenueDraftAction before their owner application is
    // approved — see Phase 6's owner-approval gatekeeper).
    test: (e) => e.code === "42501",
    message: "You need an approved owner account to do that.",
  },
  {
    // Postgres exclusion_violation — the bookings_no_overlap constraint
    // (see supabase/migrations/20260810000004_bookings.sql) rejecting a
    // double-booking attempt. lib/services/bookings.ts already catches
    // this specific code and throws a typed BookingError with the same
    // message before it would normally reach here; this entry is a
    // second-layer safety net for any other code path that might hit the
    // same constraint without going through createBooking().
    test: (e) => e.code === "23P01",
    message: "That time slot is no longer available.",
  },
];

export function getFriendlyErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  const e = asErrorLike(error);
  return PATTERNS.find((p) => p.test(e))?.message ?? fallback;
}

export function logServerError(scope: string, error: unknown, options?: { critical?: boolean }) {
  // Centralized so a later phase can swap in real error reporting
  // (Sentry, etc.) in one place instead of every call site.
  console.error(`[${scope}]`, error);

  // Vercel's runtime logs have no alerting or retention of their own —
  // console.error above is otherwise the entire observability layer, seen
  // only by someone who happens to be reading logs. `critical` is for the
  // handful of call sites where that silence means a customer's money
  // moved and their booking didn't (see e.g. reportUnconfirmedPayment() in
  // lib/services/bookings.ts) — genuinely rare, so a real-time email is
  // proportionate; this is not meant to become the default for every
  // logServerError call site.
  if (options?.critical) {
    void sendCriticalErrorAlert(scope, error);
  }
}

/**
 * Fire-and-forget. Dynamically imported to avoid a circular import —
 * lib/services/email.ts itself calls logServerError() on a send failure,
 * so a static import here would form a cycle. That failure path never
 * sets `critical`, so this can't recurse.
 *
 * Never throws, never awaited by the caller: an alert failing to send
 * must never be the reason the original error handling doesn't complete,
 * exactly like every other fire-and-forget email in this app.
 */
async function sendCriticalErrorAlert(scope: string, error: unknown): Promise<void> {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) return; // Not configured — console.error above is still the record.

  try {
    const { sendEmail } = await import("@/lib/services/email");
    const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await sendEmail({
      to,
      subject: `[AIR/Rally ALERT] ${scope}`,
      html: `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${escape(scope)}\n\n${escape(detail)}</pre>`,
    });
  } catch {
    // Already logged by console.error above; the alert is best-effort on
    // top of that, not the record of truth.
  }
}
