/**
 * Apple App Site Association — the half of Universal Links that lives on the
 * website rather than in the app.
 *
 * When someone opens an air-rally.com link on an iOS device, the system fetches
 * this file to decide whether the AIR/Rally app may claim it. Without it, the
 * app's `associatedDomains` entitlement is a claim the domain never confirms,
 * and every link opens Safari instead.
 *
 * THREE THINGS HERE FAIL SILENTLY IF THEY ARE WRONG. There is no error
 * anywhere — links simply keep opening in the browser:
 *
 *   1. NO REDIRECTS on this path. Apple's fetcher abandons the request on any
 *      redirect at all, including an HTTP→HTTPS upgrade. Verified 2026-08-27:
 *      https://air-rally.com/.well-known/apple-app-site-association serves
 *      directly with zero redirects.
 *
 *      ⚠️ https://WWW.air-rally.com redirects to the apex. So the app must
 *      declare `applinks:air-rally.com`, NOT the www host — pointing it at www
 *      means Apple follows a redirect and gives up.
 *
 *   2. Content-Type MUST be application/json, on a file with no extension.
 *      Next.js will not infer that, which is the reason this is a route
 *      handler rather than a file in public/.
 *
 *   3. Valid HTTPS certificate, uncompressed, under 128KB.
 *
 * AND APPLE CACHES THIS. A wrong first version persists on devices that already
 * fetched it, so verify the DEPLOYED response before the app ships against it —
 * not the local file.
 *
 * IDs verified from the mobile repo itself (air-rally-mobile/eas.json and
 * app.json), not copied from a message: appleTeamId Z5643XKUTZ,
 * bundleIdentifier com.airrally.app. The App Store listing id (6803324731)
 * matches the live app, which is a third corroboration of the same identity.
 */

// No request data is read, so this prerenders — the AASA response does not need
// to pay the per-request render cost the root layout imposes on pages.
export const dynamic = "force-static";

/**
 * Scoped to /courts/* deliberately.
 *
 * That is the only public, non-auth-gated route the app shares. Ranked match
 * results and COURT/Side posts are sign-in gated, so a Universal Link to one
 * would hand a first-time visitor straight to a login wall inside the app —
 * strictly worse than the web page they tapped. Widening this is a product
 * decision, not a configuration tidy-up.
 */
const ASSOCIATION = {
  applinks: {
    details: [
      {
        appID: "Z5643XKUTZ.com.airrally.app",
        paths: ["/courts/*"],
      },
    ],
  },
} as const;

export function GET() {
  return new Response(JSON.stringify(ASSOCIATION), {
    status: 200,
    headers: {
      // Explicit, because the path has no file extension for anything to infer
      // from. This is the single most common reason a correct-looking AASA
      // never works.
      "Content-Type": "application/json",
      // Apple caches regardless; this keeps CDNs from holding a stale copy
      // longer than the app's own release cycle.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
