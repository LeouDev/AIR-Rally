"use client";

import { toast } from "sonner";

/**
 * The design's SHARE RESULT button, made to actually do something rather
 * than sit there as a mockup affordance. `navigator.share` covers the
 * mobile web target (and the Expo app's in-app browser, where this route
 * is what /payment-return-style deep links reuse); the clipboard fallback
 * covers desktop, where there's rarely a share sheet to hand off to.
 *
 * `url` points at the public, no-session result page
 * (/ranked/results/[matchId] — migration 20260810000107) rather than
 * /ranked/match/[matchId], which is gated to participants. Without it, a
 * "shared result" was text with nothing behind it — nobody the player
 * sent it to could actually see the match, only read a claim about it.
 */
export function ShareResultButton({ text, url }: { text: string; url?: string }) {
  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(url ? { text, url } : { text });
        return;
      } catch {
        // User cancelled the share sheet, or the platform rejected it —
        // either way, fall through to the clipboard copy below.
      }
    }
    try {
      await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
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
