import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { OWNER_AGREEMENT } from "@/lib/legalContent";
import { CURRENT_OWNER_AGREEMENT_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Venue Owner Agreement" };

/**
 * The text lives in lib/legalContent.ts alongside the User Agreement and
 * Privacy Policy. Acknowledgement itself — the checkbox and insurance
 * question — happens in OwnerApplicationWizard's final step, not here;
 * this page is the read-only document that step links to, same
 * separation /terms already has from the signup form's own checkbox.
 */
export default function OwnerAgreementPage() {
  return (
    <LegalDocumentView
      document={OWNER_AGREEMENT}
      version={CURRENT_OWNER_AGREEMENT_VERSION}
      effectiveDate="18 August 2026"
      reviewStatus="Pending review by qualified counsel"
    />
  );
}
