"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { requestOwnerAccessAction } from "@/lib/actions/ownerApplications";
import type { OwnerStatus } from "@/lib/supabase/types";

type OwnerApplicationCTAProps = {
  ownerStatus: OwnerStatus;
};

// No pickleball-paddle glyph exists in lucide-react — reuses the same
// small custom line icon ProfileHeader's own card already draws, kept in
// the same stroke style as the rest of the app's icons.
function PaddleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="6" y="2" width="12" height="14" rx="6" />
      <line x1="12" y1="16" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  );
}

/**
 * Replaces the old unconditional `role === "player"` -> "/list-your-court"
 * CTA (Phase 6, Part 4). `role === "venue_owner" | "admin"` never renders
 * this at all — the caller (ProfileHeader) only mounts it for players.
 */
export function OwnerApplicationCTA({ ownerStatus }: OwnerApplicationCTAProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (ownerStatus === "pending") {
    return (
      <Link
        href="/owner/onboarding"
        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
          <PaddleIcon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Your owner application is under review</p>
          <p className="text-sm text-muted-foreground">Our team reviews your facility before it goes live. Check status</p>
        </div>
      </Link>
    );
  }

  function handleStart() {
    startTransition(async () => {
      const result = await requestOwnerAccessAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push("/owner/onboarding");
    });
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={isPending}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-70 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <PaddleIcon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">🏟 Become a Venue Owner</p>
          <p className="text-sm text-muted-foreground">Have a court? Turn unused hours into income with AIR/Rally.</p>
        </div>
      </div>
      <span className="text-sm font-medium text-primary sm:ml-auto sm:shrink-0">
        {isPending ? "Starting…" : "Start Owner Application"}
      </span>
    </button>
  );
}
