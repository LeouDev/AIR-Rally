import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOwnerApplicationForUser } from "@/lib/services/ownerApplications";
import { OwnerOnboardingContent } from "@/components/owner/OwnerOnboardingContent";

// Reads the caller's own session/owner_status — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Become a Venue Owner" };

export default async function OwnerOnboardingPage() {
  const session = await getCurrentUserWithProfile();

  // Already a real owner/admin — nothing to onboard, send them to the
  // dashboard they already have (matches the existing /list-your-court flow).
  if (session?.profile && (session.profile.role === "venue_owner" || session.profile.role === "admin")) {
    redirect("/list-your-court");
  }

  let hasSubmittedApplication = false;
  if (session?.user) {
    const supabase = await createClient();
    const application = await getOwnerApplicationForUser(supabase, session.user.id);
    // Only a still-pending application blocks re-submission — a rejected
    // one is exactly what lets the applicant re-apply (see
    // prevent_owner_status_tampering()'s 'rejected' -> 'pending' allowance).
    hasSubmittedApplication = application?.status === "pending";
  }

  return (
    <Suspense>
      <OwnerOnboardingContent
        isSignedIn={!!session?.user}
        ownerStatus={session?.profile?.owner_status ?? "none"}
        hasSubmittedApplication={hasSubmittedApplication}
      />
    </Suspense>
  );
}
