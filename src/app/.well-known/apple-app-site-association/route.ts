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
 * The pages the app can open, and only those. Each one must already resolve
 * to a real screen in the app — its +native-intent rewrites
 * (lib/deep-link-target.ts) cover the web paths it names differently — or the
 * link opens the app to "Page not found", worse than staying in Safari.
 *
 * Left to the web on purpose: /ranked/results/* (the public, sign-in-free
 * result page; the app's match room is not the same page),
 * /venues/requests/*, /payment-return, the owner and admin tools, auth.
 *
 * Signed-out app users: the app remembers the tapped link and replays it once
 * they sign in, so a claimed path no longer strands them on Explore.
 *
 * SHIP ORDER: the app release carrying those rewrites and the replay must be
 * live BEFORE this deploys. Apple caches this file for hours to days, so a
 * claim that lands first sends links into an app that can't open them yet.
 */
const APP_PATHS = [
  "/courts/*",
  "/bookings",
  "/bookings/*/confirmation",
  "/events",
  "/events/*",
  "/clubs",
  "/clubs/*",
  "/court-side",
  "/court-side/*",
  "/ranked/match/*",
  "/ranked/new",
  "/ranked/leaderboard",
  "/notifications",
  "/favorites",
  "/support",
  "/profile",
  "/profile/*",
  "/explore",
];

const ASSOCIATION = {
  applinks: {
    details: [
      {
        appID: "Z5643XKUTZ.com.airrally.app",
        paths: APP_PATHS,
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
