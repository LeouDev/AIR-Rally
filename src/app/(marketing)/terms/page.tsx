import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { TERMS } from "@/lib/legalContent";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "User Agreement" };

/**
 * The text lives in lib/legalContent.ts so this page, /privacy, and the
 * PDF handed to counsel all render the same words. Bump
 * CURRENT_AGREEMENT_VERSION whenever the terms change — new signups are
 * recorded against it.
 */
export default function TermsPage() {
  return (
    <LegalDocumentView
      document={TERMS}
      version={CURRENT_AGREEMENT_VERSION}
      effectiveDate="17 August 2026"
    />
  );
}
