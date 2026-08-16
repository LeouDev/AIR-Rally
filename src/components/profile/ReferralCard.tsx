"use client";

import { useState } from "react";
import { Copy, Check, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ReferralCardProps = {
  referralCode: string;
};

/**
 * "Know someone who owns a court?" (Phase 6, Part 6). Builds the link
 * client-side from window.location.origin — this component has no
 * server context to call getSiteUrl() from, and the origin is available
 * by the time a user can actually click "Refer a Court Owner" (after
 * hydration), so a brief empty-string fallback during SSR is harmless.
 */
export function ReferralCard({ referralCode }: ReferralCardProps) {
  // Lazy initializers, not an effect — window/navigator are read once at
  // mount (client-only globals, unavailable during SSR, but this
  // component only ever renders after hydration reaches this branch of
  // the profile page), so there's nothing to "synchronize" that would
  // warrant useEffect.
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [canShare] = useState(() => typeof navigator !== "undefined" && typeof navigator.share === "function");
  const [copied, setCopied] = useState(false);

  const referralUrl = `${origin}/owner/onboarding?ref=${referralCode}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    try {
      await navigator.share({ title: "Join AIR/Rally", text: "Help your favorite court join AIR/Rally.", url: referralUrl });
    } catch {
      // User cancelled the native share sheet — not an error.
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Users className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">🤝 Know someone who owns a court?</p>
          <p className="text-sm text-muted-foreground">Help your favorite court join AIR/Rally.</p>
        </div>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto sm:shrink-0">
            Refer a Court Owner
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <p className="text-sm font-medium text-foreground">Your referral link</p>
          <p className="mt-1 truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{referralUrl}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={handleCopy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {canShare && (
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={handleShare}>
                <Share2 className="size-4" />
                Share
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
