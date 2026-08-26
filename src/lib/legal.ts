/**
 * Single source of truth for "which User Agreement version is currently
 * required at signup." Bump this string whenever the actual Terms
 * change — every new signup will then be recorded against the new
 * version, and (once a re-acceptance flow exists) existing users could
 * be compared against it. Bumping this alone never requires a migration.
 *
 * "SINGLE SOURCE OF TRUTH" IS ASPIRATIONAL, NOT STRUCTURAL — and it has
 * already failed once. The mobile app carries its own copy of this
 * constant and its own copy of the Terms text. Between 2026-08-17 and
 * 2026-08-26 the two disagreed: mobile said "2026-08-23" and carried a
 * corrected §7, while this repo still said "2026-08-17" and carried §7's
 * superseded wording. Since both clients write to the same
 * agreement_acceptances table, the version recorded against a user
 * depended on which app they signed up in rather than on what they
 * agreed to.
 *
 * Nothing enforces that the two stay in step. Until a shared source or a
 * content hash on the acceptance row exists, THIS CONSTANT AND MOBILE'S
 * MUST BE CHANGED TOGETHER, in the same breath, or the next divergence
 * will be as invisible as the last.
 */
export const CURRENT_AGREEMENT_VERSION = "2026-08-23";

/**
 * Same idea as CURRENT_AGREEMENT_VERSION, but for the Venue Owner
 * Agreement (src/lib/legalContent.ts#OWNER_AGREEMENT) — recorded against
 * owner_applications.agreement_version at submission time. A distinct
 * constant because the two documents change on independent schedules.
 */
export const CURRENT_OWNER_AGREEMENT_VERSION = "1.1";

/**
 * Shown on both /terms and /privacy, and carried into the PDF handed to
 * counsel. These documents describe what the platform actually does
 * today — they have not been reviewed by a lawyer, and that has to be
 * visible to anyone reading them rather than buried.
 */
export const LEGAL_REVIEW_STATUS = "Pending review by qualified counsel";

/** Where privacy and legal requests go until a dedicated address exists. */
export const LEGAL_CONTACT_ROUTE = "/support";
