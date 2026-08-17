import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { PRIVACY } from "@/lib/legalContent";
import { LEGAL_REVIEW_STATUS } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

/**
 * Text lives in lib/legalContent.ts, shared with /terms and the PDF
 * produced for counsel. No version number here: the Privacy Policy is not
 * something users accept at signup, so there is nothing to record against
 * them — only the User Agreement carries a version.
 */
export default function PrivacyPage() {
  return <LegalDocumentView document={PRIVACY} effectiveDate="17 August 2026" reviewStatus={LEGAL_REVIEW_STATUS} />;
}
