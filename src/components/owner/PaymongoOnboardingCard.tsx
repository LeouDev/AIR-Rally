"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { startPaymongoOnboardingAction } from "@/lib/actions/venueOnboarding";
import type { VenuePaymongoActivationStatus } from "@/lib/supabase/types";

type PaymongoOnboardingCardProps = {
  venueId: string;
  activationStatus: VenuePaymongoActivationStatus;
  declinedReason: string | null;
};

/**
 * Experimental — PayMongo Platforms marketplace onboarding (see
 * ARCHITECTURE.md). Only `activated` unlocks the 95%/5% split checkout
 * for this venue's bookings (Phase 3); every other state still lets the
 * venue's non-split payment paths work exactly as before.
 */
export function PaymongoOnboardingCard({ venueId, activationStatus, declinedReason }: PaymongoOnboardingCardProps) {
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const result = await startPaymongoOnboardingAction(venueId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.data.verificationUrl;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">PayMongo payouts</CardTitle>
          <StatusBadge status={activationStatus} />
        </div>
        <CardDescription>
          Link this venue to PayMongo so you can receive your share of booking payments directly (experimental, TEST MODE
          only).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {activationStatus === "unlinked" && (
          <>
            <p className="text-sm text-muted-foreground">
              You&apos;ll be redirected to PayMongo to verify your identity. AIR/Rally never collects or stores your ID or
              bank documents — PayMongo handles that directly.
            </p>
            <Button type="button" onClick={handleStart} disabled={isPending} className="self-start">
              {isPending ? "Starting…" : "Connect PayMongo"}
            </Button>
          </>
        )}

        {(activationStatus === "pending" || activationStatus === "under_review") && (
          <>
            <p className="text-sm text-muted-foreground">
              Verification is in progress. This can take a little while — we&apos;ll update this automatically once
              PayMongo finishes reviewing your account.
            </p>
            <Button type="button" variant="outline" onClick={handleStart} disabled={isPending} className="self-start">
              {isPending ? "Opening…" : "Resume verification"}
            </Button>
          </>
        )}

        {activationStatus === "activated" && (
          <p className="text-sm text-muted-foreground">
            PayMongo is connected — this venue can now receive its 95% share of booking payments automatically.
          </p>
        )}

        {activationStatus === "declined" && (
          <>
            <p className="text-sm text-destructive">
              {declinedReason ?? "PayMongo declined this account during review."}
            </p>
            <p className="text-sm text-muted-foreground">
              Contact PayMongo support if you believe this was a mistake — this decision can&apos;t be retried from here.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: VenuePaymongoActivationStatus }) {
  switch (status) {
    case "activated":
      return <Badge variant="default">Connected</Badge>;
    case "pending":
    case "under_review":
      return <Badge variant="secondary">Verifying</Badge>;
    case "declined":
      return <Badge variant="destructive">Declined</Badge>;
    default:
      return <Badge variant="outline">Not connected</Badge>;
  }
}
