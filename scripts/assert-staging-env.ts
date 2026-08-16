/**
 * A hard safety gate for every staging-only script in this project (the
 * V1 rescheduling verification pass — see the production-readiness
 * audit and its follow-up staging-verification task). Import this at the
 * very top of any script that's about to touch a database or call a
 * payment provider as part of staging verification — it throws
 * immediately if the currently-loaded Supabase environment resolves to
 * this project's known, real, long-lived project
 * ("hrpbjudsrqcgyrkkodop" — see ARCHITECTURE.md's Phase 2.5 section),
 * regardless of which env file was actually sourced into the shell.
 *
 * This exists specifically because sourcing the wrong file (.env.local
 * instead of .env.staging, or a staging file that was never actually
 * pointed at a new project) is exactly the kind of mistake that's easy
 * to make once and expensive to discover after the fact. This check
 * does not trust a filename or which file was intended to be sourced —
 * it inspects the actual resolved NEXT_PUBLIC_SUPABASE_URL value.
 *
 * Usage: `import "./assert-staging-env";` as the first import in a
 * staging verification script, after env vars are already loaded into
 * process.env (e.g. `set -a && source .env.staging && set +a` before
 * invoking node). Every script in this directory that imports this
 * should be run as:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/<name>.ts
 * (the compiler-options override works around a pre-existing environment
 * quirk — Node 22 + this project's tsconfig `"module": "esnext"` — that
 * affects every scripts/*.ts file in this repo, not just staging ones).
 */

const KNOWN_PRODUCTION_PROJECT_REF = "hrpbjudsrqcgyrkkodop";

function assertNotProduction(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "assert-staging-env: NEXT_PUBLIC_SUPABASE_URL is not set. Refusing to proceed — " +
        "source .env.staging (never .env.local) before running a staging verification script."
    );
  }
  if (url.includes(KNOWN_PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `assert-staging-env: REFUSING TO PROCEED. The currently-loaded NEXT_PUBLIC_SUPABASE_URL ` +
        `resolves to this project's known real/production Supabase project (${KNOWN_PRODUCTION_PROJECT_REF}). ` +
        `Staging verification scripts must only ever run against a separate, disposable project. ` +
        `Check which env file was actually sourced.`
    );
  }

  // DATABASE_URL is what the direct-Postgres migration/verification
  // scripts actually connect with — checked separately and just as
  // strictly, since it's a genuinely different value that could in
  // principle point somewhere NEXT_PUBLIC_SUPABASE_URL doesn't (a stale
  // copy-paste, a pooler URL where the ref lives in the username instead
  // of the hostname, etc.). Only enforced when it's actually set, since
  // not every staging script needs a raw Postgres connection.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.includes(KNOWN_PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `assert-staging-env: REFUSING TO PROCEED. The currently-loaded DATABASE_URL ` +
        `resolves to this project's known real/production Supabase project (${KNOWN_PRODUCTION_PROJECT_REF}). ` +
        `Check which env file was actually sourced.`
    );
  }

  console.log(`[assert-staging-env] OK — target project host: ${new URL(url).host} (not the known production ref)`);
  if (databaseUrl) {
    console.log("[assert-staging-env] DATABASE_URL is set and does not reference the known production ref.");
  }
}

assertNotProduction();
