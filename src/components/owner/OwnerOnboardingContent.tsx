"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/shared/BackLink";
import { OwnerApplicationWizard, OwnerApplicationSubmittedState } from "@/components/owner/OwnerApplicationWizard";
import { requestOwnerAccessAction } from "@/lib/actions/ownerApplications";
import type { OwnerStatus } from "@/lib/supabase/types";

type OwnerOnboardingContentProps = {
  isSignedIn: boolean;
  ownerStatus: OwnerStatus;
  hasSubmittedApplication: boolean;
};

// Wording constraint: never imply funds automatically reach an owner's
// bank account. Checkout genuinely works, so "customers pay securely
// online" is true; settlement/payout mechanics are not live yet, so
// "get paid", "payout", and "money in your account" are all off-limits
// here (see lib/services/venueEarnings.ts's doc comment).
const BENEFITS = [
  { emoji: "🏸", title: "Get discovered by more customers", description: "Players search, compare, and find your facility on the AIR/Rally marketplace." },
  { emoji: "💳", title: "Secure online payments", description: "Customers pay securely online when they book — no chasing payments, no manual collection." },
  { emoji: "📅", title: "A digital calendar that runs itself", description: "Manage availability, court schedules, and blocked times in one place." },
  { emoji: "🗂️", title: "Less admin work", description: "Bookings, cancellations, and reschedules are handled for you instead of over chat." },
  { emoji: "📸", title: "Better visibility for your venue", description: "Showcase court photos, venue photos, amenities, and your exact location." },
  { emoji: "⭐", title: "Build your reputation", description: "Receive reviews, ratings, and repeat customers." },
];

const FAQS = [
  {
    q: "Do I need to collect payment from customers?",
    a: "No. Customers pay through AIR/Rally when they book. You manage your facility while AIR/Rally manages the booking experience.",
  },
  {
    q: "What happens after I apply?",
    a: "Our team reviews your facility before it becomes available to players.",
  },
];

/**
 * Single route, client-toggled between landing/wizard/submitted views
 * (Phase 6, Part 5) — no separate /apply route. `ownerStatus` and
 * `hasSubmittedApplication` come from the server (page.tsx); the
 * `?ref=` code, if present, is only ever resolved into a referral row
 * the moment the visitor actually starts an application, never just
 * from viewing this page.
 */
export function OwnerOnboardingContent({ isSignedIn, ownerStatus, hasSubmittedApplication }: OwnerOnboardingContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refCode = searchParams.get("ref") ?? undefined;

  const [view, setView] = useState<"landing" | "wizard" | "submitted">("landing");
  const [isStarting, setIsStarting] = useState(false);

  async function handleStart() {
    if (!isSignedIn) {
      const redirectTarget = refCode ? `/owner/onboarding?ref=${refCode}` : "/owner/onboarding";
      router.push(`/signup?intendedRole=venue_owner&redirect=${encodeURIComponent(redirectTarget)}`);
      return;
    }

    if (ownerStatus === "none" || ownerStatus === "rejected") {
      setIsStarting(true);
      const result = await requestOwnerAccessAction(refCode);
      setIsStarting(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
    }
    setView("wizard");
  }

  if (view === "submitted") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-4">
          <BackLink href="/profile" label="Back to profile" />
        </div>
        <OwnerApplicationSubmittedState />
      </div>
    );
  }

  if (view === "wizard") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Back to the landing view, not to /profile — the wizard is a
            client-toggled view of this same route, so there is no history
            entry to return to and a link would leave the flow entirely. */}
        <button
          type="button"
          onClick={() => setView("landing")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <OwnerApplicationWizard onSubmitted={() => setView("submitted")} />
      </div>
    );
  }

  const showsAlreadySubmittedNotice = ownerStatus === "pending" && hasSubmittedApplication;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Only for signed-in visitors: /profile is where the CTA that
          reaches this page lives, and it redirects anyone signed out. */}
      {isSignedIn && (
        <div className="mb-6">
          <BackLink href="/profile" label="Back to profile" />
        </div>
      )}
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
          Turn your court into a business with AIR/Rally
        </h1>
        <div className="mt-8">
          {showsAlreadySubmittedNotice ? (
            <p className="text-sm font-medium text-muted-foreground">
              Your owner application is under review. We&apos;ll be in touch soon.
            </p>
          ) : (
            <Button size="lg" onClick={handleStart} disabled={isStarting}>
              {isStarting
                ? "Starting…"
                : !isSignedIn
                  ? "Sign up to apply"
                  : ownerStatus === "pending"
                    ? "Continue Application"
                    : "Start Owner Application"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-16 grid gap-6 sm:grid-cols-2">
        {BENEFITS.map((benefit) => (
          <div key={benefit.title} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-2xl leading-none">{benefit.emoji}</p>
            <p className="mt-3 font-semibold text-foreground">{benefit.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{benefit.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-16">
        <h2 className="text-xl font-semibold text-foreground">Frequently asked questions</h2>
        <dl className="mt-4 flex flex-col gap-5">
          {FAQS.map((faq) => (
            <div key={faq.q}>
              <dt className="font-medium text-foreground">{faq.q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
