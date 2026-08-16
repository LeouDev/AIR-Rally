import type { Metadata } from "next";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "User Agreement" };

/**
 * Placeholder legal content — deliberately not fabricated binding legal
 * language. The actual Terms of Service / Privacy Policy text needs
 * review from AIR/Rally's own legal counsel before launch; this page
 * exists so the signup flow has something real to link to and so
 * CURRENT_AGREEMENT_VERSION (lib/legal.ts) has a visible home. Update
 * this page's content and CURRENT_AGREEMENT_VERSION together.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">User Agreement</h1>
      <p className="mt-1 text-sm text-muted-foreground">Version {CURRENT_AGREEMENT_VERSION}</p>

      <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This page is a placeholder. The real Terms of Service and Privacy Policy text has not been drafted or
        reviewed by legal counsel yet — do not treat anything below as binding. Replace this content (and bump{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">CURRENT_AGREEMENT_VERSION</code> in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">lib/legal.ts</code>) before launch.
      </div>

      <div className="mt-8 flex flex-col gap-4 text-sm leading-relaxed text-foreground">
        <p>By creating an AIR/Rally account, you agree to use the platform to discover and book pickleball courts in good faith.</p>
        <p>
          Booking payments are processed by a third-party payment provider. AIR/Rally does not store your card or
          bank details.
        </p>
        <p>Full terms, including cancellation and refund policy, will be published here before public launch.</p>
      </div>
    </div>
  );
}
