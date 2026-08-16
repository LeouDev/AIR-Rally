/**
 * Single source of truth for "which User Agreement version is currently
 * required at signup." Bump this string whenever the actual Terms
 * change — every new signup will then be recorded against the new
 * version, and (once a re-acceptance flow exists) existing users could
 * be compared against it. Bumping this alone never requires a migration.
 */
export const CURRENT_AGREEMENT_VERSION = "2026-08-16";
