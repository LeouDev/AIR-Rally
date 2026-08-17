"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// ~4s apart for ~2 minutes. Long enough to cover an e-wallet posting a
// little after the redirect, short enough that we stop hitting the
// server (and PayMongo, via the page's reconcile) for someone who
// abandoned the tab.
const POLL_INTERVAL_MS = 4000;
const MAX_ATTEMPTS = 30;

/**
 * Re-checks a pending booking on its own while the customer waits.
 *
 * The confirmation page already reconciles against PayMongo on every
 * load — but only on a load, and it simply told the customer to press
 * Refresh. With QR Ph and the other e-wallets the payment often posts a
 * few seconds AFTER the redirect lands, so the first render is
 * legitimately pending and the page then sat there unchanged. Someone
 * who had genuinely paid was left looking at a screen that never
 * updated, with no signal that waiting would help.
 *
 * router.refresh() re-runs the server component, which re-runs the
 * reconcile; once the booking flips to confirmed the page renders the
 * success state and this component unmounts with it. The manual button
 * stays as the fallback for anyone who waits out the window.
 */
export function PendingPaymentAutoRefresh() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const exhausted = attempts >= MAX_ATTEMPTS;

  useEffect(() => {
    if (exhausted) return;
    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempts, exhausted, router]);

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      {exhausted ? (
        "Still not confirmed. Your payment is safe — check My Bookings in a few minutes, or contact us with your booking details."
      ) : (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Checking for your payment…
        </>
      )}
    </p>
  );
}
