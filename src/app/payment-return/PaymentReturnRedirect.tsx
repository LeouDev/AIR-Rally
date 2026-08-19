"use client";

import { useEffect } from "react";

/** Fires the app deep link as soon as the page loads, and leaves a manual
 * button behind for browsers that swallow automatic scheme navigation
 * (some in-app browsers only honour it from a user gesture). */
export function PaymentReturnRedirect({ deepLink }: { deepLink: string }) {
  useEffect(() => {
    window.location.replace(deepLink);
  }, [deepLink]);

  return (
    <a
      href={deepLink}
      className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      Back to the app
    </a>
  );
}
