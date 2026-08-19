"use client";

import { toast } from "sonner";

/**
 * The design's SHARE RESULT button, made to actually do something rather
 * than sit there as a mockup affordance. `navigator.share` covers the
 * mobile web target (and the Expo app's in-app browser, where this route
 * is what /payment-return-style deep links reuse); the clipboard fallback
 * covers desktop, where there's rarely a share sheet to hand off to.
 */
export function ShareResultButton({ text }: { text: string }) {
  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User cancelled the share sheet, or the platform rejected it —
        // either way, fall through to the clipboard copy below.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied — paste it anywhere.");
    } catch {
      toast.error("Couldn't share this result.");
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="w-full bg-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase"
    >
      Share result
    </button>
  );
}
