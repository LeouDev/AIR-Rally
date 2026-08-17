"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OAuthButtonsProps = {
  /** Where to land once signed in — for a RETURNING user. A first-time
   * arrival is routed to the trimmed signup-completion step instead,
   * regardless of this value; see src/app/auth/callback/route.ts. */
  redirectTo: string;
  /** Carried through only on the signup page, so a fresh OAuth arrival
   * lands on the completion step with their chosen role pre-selected —
   * the same intent the email/password form captures via its own role
   * picker before submitting. */
  intendedRole?: "player" | "venue_owner";
};

/**
 * "Continue with Google/Facebook," shared by /login and /signup — the
 * button does the exact same thing either way (signInWithOAuth() both
 * signs in an existing account and creates a new one transparently), so
 * there's nothing page-specific except which redirect params to carry.
 *
 * Client-side because signInWithOAuth() has to run in the browser — it
 * navigates the page itself to the provider's consent screen, there's no
 * server round-trip to wrap this in a server action for.
 */
export function OAuthButtons({ redirectTo, intendedRole }: OAuthButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<"google" | "facebook" | null>(null);

  async function handleOAuth(provider: "google" | "facebook") {
    setPendingProvider(provider);
    const supabase = createClient();

    const params = new URLSearchParams({ next: redirectTo });
    if (intendedRole) params.set("intendedRole", intendedRole);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?${params.toString()}` },
    });

    // Success navigates the browser away to the provider — there is no
    // "then" to handle. Only a failure to even START that redirect
    // reaches here (provider not configured, network error).
    if (error) {
      setPendingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={pendingProvider !== null}
        className="flex h-11 items-center justify-center gap-2.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        <GoogleIcon className="size-4.5" />
        {pendingProvider === "google" ? "Connecting…" : "Continue with Google"}
      </button>
      <button
        type="button"
        onClick={() => handleOAuth("facebook")}
        disabled={pendingProvider !== null}
        className="flex h-11 items-center justify-center gap-2.5 rounded-lg bg-[#1877F2] text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <FacebookIcon className="size-4.5" />
        {pendingProvider === "facebook" ? "Connecting…" : "Continue with Facebook"}
      </button>

      <div className="my-1 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4-3.09Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.6 4.6 1.79l3.45-3.45C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.63l4 3.09C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.07C24 5.66 18.63.3 12 .3S0 5.66 0 12.07c0 5.79 4.39 10.59 10.13 11.44v-8.1H7.08v-3.34h3.05V9.41c0-3 1.83-4.66 4.6-4.66 1.33 0 2.72.24 2.72.24v2.94H16v-1.66c0-1.45.81-2.13 2.13-2.13.65 0 1.33.08 1.33.08v3.02h-1.7c-1.65 0-2.17 1.02-2.17 2.06v2.4h3.7l-.59 3.34h-3.11v8.1C19.61 22.66 24 17.86 24 12.07Z" />
    </svg>
  );
}
