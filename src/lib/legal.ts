/**
 * Single source of truth for "which User Agreement version is currently
 * required at signup." Bump this string whenever the actual Terms
 * change — every new signup will then be recorded against the new
 * version, and (once a re-acceptance flow exists) existing users could
 * be compared against it. Bumping this alone never requires a migration.
 */
export const CURRENT_AGREEMENT_VERSION = "2026-08-17";

/**
 * Same idea as CURRENT_AGREEMENT_VERSION, but for the Venue Owner
 * Agreement (src/lib/legalContent.ts#OWNER_AGREEMENT) — recorded against
 * owner_applications.agreement_version at submission time. A distinct
 * constant because the two documents change on independent schedules.
 */
export const CURRENT_OWNER_AGREEMENT_VERSION = "1.0";

/**
 * Shown on both /terms and /privacy, and carried into the PDF handed to
 * counsel. These documents describe what the platform actually does
 * today — they have not been reviewed by a lawyer, and that has to be
 * visible to anyone reading them rather than buried.
 */
export const LEGAL_REVIEW_STATUS = "Pending review by qualified counsel";

/** Where privacy and legal requests go until a dedicated address exists. */
export const LEGAL_CONTACT_ROUTE = "/support";
