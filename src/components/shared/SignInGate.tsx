import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { BackLink } from "@/components/shared/BackLink";
import { Button } from "@/components/ui/button";

/**
 * The signed-out state for a page whose CONTENT stays gated (unlike
 * /support, which shows something — an email fallback — to everyone
 * regardless of auth). Replaces a blind requireSignedIn() redirect to
 * /login with a real, branded page: a visitor who taps a shared link
 * should see what they were trying to open and why they're being asked
 * to sign in, then land back on that exact page afterward — not the
 * homepage, and not a bare login form with no context.
 *
 * Shared between /ranked/match/[matchId] and /court-side/[userId]
 * because both are genuinely the same shape (icon, title, description,
 * a Sign In action that round-trips through ?redirect=); /support's own
 * signed-out state isn't a third case of this — it renders real content
 * (the email line) alongside the sign-in prompt, which is a different
 * job than "gate everything."
 */
export function SignInGate({
  icon,
  title,
  description,
  redirectTo,
  backLink,
  showCreateAccount = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  redirectTo: string;
  backLink?: { href: string; label: string };
  showCreateAccount?: boolean;
}) {
  const encodedRedirect = encodeURIComponent(redirectTo);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      {backLink && (
        <div className="mb-4">
          <BackLink href={backLink.href} label={backLink.label} />
        </div>
      )}
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={
          <div className="flex gap-3">
            <Button asChild>
              <Link href={`/login?redirect=${encodedRedirect}`}>Sign In</Link>
            </Button>
            {showCreateAccount && (
              <Button asChild variant="outline">
                <Link href={`/signup?redirect=${encodedRedirect}`}>Create Account</Link>
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
