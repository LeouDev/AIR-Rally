import Link from "next/link";
import type { LegalDocument } from "@/lib/legalContent";

/**
 * Renders a LegalDocument for the public site.
 *
 * `reviewNote` is deliberately NOT rendered here. Those are questions for
 * the reviewing lawyer and appear only in the PDF produced by
 * scripts/generate-legal-pdf.ts — putting "counsel should confirm whether
 * this is enforceable" in front of a customer would undermine the very
 * clause it sits under.
 *
 * No review-status banner here either — removed at the business owner's
 * direction. LEGAL_REVIEW_STATUS (lib/legal.ts) still exists and still
 * appears in the counsel PDF; it's just no longer shown to customers.
 */
export function LegalDocumentView({
  document,
  version,
  effectiveDate,
}: {
  document: LegalDocument;
  version?: string;
  effectiveDate: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{document.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {version ? `Version ${version} · ` : ""}
        Last updated {effectiveDate}
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {document.intro.map((paragraph, i) => (
          <p key={i} className="text-sm leading-relaxed text-foreground">
            {paragraph}
          </p>
        ))}

        {document.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          See also the{" "}
          <Link href={document.title === "Privacy Policy" ? "/terms" : "/privacy"} className="text-primary hover:underline">
            {document.title === "Privacy Policy" ? "User Agreement" : "Privacy Policy"}
          </Link>
          , or{" "}
          <Link href="/support" className="text-primary hover:underline">
            contact support
          </Link>{" "}
          with a question.
        </p>
      </div>
    </div>
  );
}
