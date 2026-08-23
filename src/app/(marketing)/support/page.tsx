import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Clock, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listMySupportRequests } from "@/lib/services/reports";
import { SupportForm } from "@/components/trust/SupportForm";
import type { SupportStatus } from "@/lib/supabase/types";

/**
 * Apple requires the App Store Connect Support URL to give an anonymous
 * visitor a way to reach support — this is exactly who an App Review
 * reviewer is. Verified the address is real and monitored with the
 * founder directly before using it here; it's also already promised in
 * the signup welcome email (src/lib/emails/signupWelcomeEmail.ts), so
 * this isn't a new promise, just the same one shown somewhere an
 * anonymous visitor can actually see it.
 */
const SUPPORT_EMAIL = "support@air-rally.com";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support" };

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "Being looked at",
  resolved: "Resolved",
  closed: "Closed",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** Renders for every visitor, signed in or not — the one thing this page must never hide. */
function SupportEmailNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Prefer email? Reach us at{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-foreground underline underline-offset-2">
        {SUPPORT_EMAIL}
      </a>
      .
    </p>
  );
}

export default async function SupportPage() {
  // Not requireSignedIn(): that redirected every anonymous visitor away
  // from this page entirely, including Apple's own App Review reviewer
  // hitting the App Store Connect Support URL — no page content, no
  // contact method, nothing. Fetching the user without redirecting lets
  // this page render something for everyone; the interactive form and
  // message history still need a session, but the email fallback and the
  // page itself no longer do.
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Get help</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us what&apos;s going on and we&apos;ll look into it.
          </p>
        </div>
        <SupportEmailNote />
        <p className="text-sm text-muted-foreground">
          <Link href="/login?redirect=%2Fsupport" className="font-medium text-foreground underline underline-offset-2">
            Sign in
          </Link>{" "}
          to send a message from the app and track its status.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const requests = await listMySupportRequests(supabase, user.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Get help</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us what&apos;s going on and we&apos;ll look into it.
        </p>
      </div>

      {/* Stated plainly rather than implied. In-app replies are the
          primary channel — promising an email reply to every message
          here would be a promise the platform cannot keep. */}
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        We reply in your AIR/Rally notifications, not by email. Check the bell in the top bar.
      </p>

      <SupportForm />

      {requests.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">Your previous messages</h2>
          <ul className="flex flex-col gap-2">
            {requests.map((request) => (
              <li key={request.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{request.subject}</p>
                  <Badge variant={request.status === "open" ? "outline" : "secondary"}>
                    {STATUS_LABELS[request.status]}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{request.message}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3" aria-hidden="true" />
                  {formatWhen(request.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SupportEmailNote />
    </div>
  );
}
