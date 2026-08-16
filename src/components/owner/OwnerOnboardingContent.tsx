"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OwnerApplicationWizard, OwnerApplicationSubmittedState } from "@/components/owner/OwnerApplicationWizard";
import { requestOwnerAccessAction } from "@/lib/actions/ownerApplications";
import type { OwnerStatus } from "@/lib/supabase/types";

type OwnerOnboardingContentProps = {
  isSignedIn: boolean;
  ownerStatus: OwnerStatus;
  hasSubmittedApplication: boolean;
};

const BENEFITS = [
  { emoji: "🏸", title: "Fill your empty court hours", description: "Players discover your facility and book available times." },
  { emoji: "💰", title: "Get paid upfront", description: "Customers pay before playing. No chasing payments. No manual collection." },
  { emoji: "📅", title: "Manage everything easily", description: "Control your availability, court schedule, blocked times, and bookings." },
  { emoji: "📸", title: "Showcase your facility", description: "Upload court photos, venue photos, amenities, and location." },
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
        <OwnerApplicationSubmittedState />
      </div>
    );
  }

  if (view === "wizard") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <OwnerApplicationWizard onSubmitted={() => setView("submitted")} />
      </div>
    );
  }

  const showsAlreadySubmittedNotice = ownerStatus === "pending" && hasSubmittedApplication;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
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
