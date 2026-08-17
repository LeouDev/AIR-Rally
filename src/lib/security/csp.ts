/**
 * Content Security Policy.
 *
 * WHAT THIS IS ACTUALLY DEFENDING
 *
 * The Supabase auth cookie is readable by JavaScript — `document.cookie`
 * on a signed-in page returns the access token AND the refresh token,
 * base64-encoded but not otherwise protected. That is inherent to
 * createBrowserClient, which must read the session client-side; it is not
 * a misconfiguration and it cannot be fixed with httpOnly without
 * abandoning the Supabase browser client.
 *
 * So any successful XSS is full account takeover, and the refresh token is
 * the sharp edge because it outlives access-token expiry. CSP is the
 * mitigation available: stop injected script from executing at all.
 *
 * WHY NONCES RATHER THAN 'unsafe-inline'
 *
 * `script-src 'self' 'unsafe-inline'` would be simpler and is what most
 * "add a CSP" changes ship. It is also close to worthless here: an
 * injected inline <script> is allowed by it, which is precisely the attack
 * being defended against. A CSP that permits the attack it is written for
 * is theatre.
 *
 * Nonces cost static rendering — Next applies them during SSR, so every
 * page must be dynamic. Measured before choosing rather than assumed: this
 * app builds 48 dynamic routes and 9 static ones, and the static ones are
 * /login, /signup, /forgot-password, /reset-password, /privacy, /terms,
 * /_not-found and two icons. The discovery surface — /, /explore, court
 * pages — is already dynamic. The cost is seven low-traffic auth and legal
 * pages, which is not a reason to ship a policy that does not work.
 *
 * WHY style-src KEEPS 'unsafe-inline'
 *
 * Deliberate, not an oversight. Leaflet positions map tiles with inline
 * style attributes, and the app uses React `style={{…}}` in several
 * components (MobileBookingBar's safe-area inset, the owner availability
 * calendar, MobileNav). A nonce does not cover inline style ATTRIBUTES —
 * only <style> elements — so a nonce-only style-src breaks the map and the
 * mobile layout outright. CSS injection is a far weaker primitive than
 * script injection, and script-src is where the account-takeover defence
 * lives.
 */

/** Supabase: the browser client talks to it directly, over https and websockets. */
const SUPABASE_ORIGINS = ["https://*.supabase.co", "wss://*.supabase.co"];

/**
 * Third-party IMAGE origins. There are no third-party SCRIPT origins —
 * confirmed by audit, and script-src deliberately allows none.
 *
 *   *.tile.openstreetmap.org — the map's tiles (VenueMap)
 *   unpkg.com                — Leaflet's marker/shadow icons, which
 *                              react-leaflet references by absolute URL
 *                              rather than bundling
 *
 * Nominatim (geocoding) is NOT here on purpose: it is called from
 * lib/services/geocoding.ts, which runs server-side via a server action,
 * so the browser never connects to it.
 */
const MAP_IMAGE_ORIGINS = ["https://*.tile.openstreetmap.org", "https://unpkg.com"];

export type CspOptions = { nonce: string; isDev: boolean };

/**
 * Builds the policy. Exported for testing — the directives that matter are
 * the ones that must NOT appear (no 'unsafe-inline' in script-src), and an
 * assertion is a better guard on that than a code review.
 */
export function buildContentSecurityPolicy({ nonce, isDev }: CspOptions): string {
  const directives: string[] = [
    `default-src 'self'`,
    // 'strict-dynamic' lets the nonced Next bootstrap load the chunks it
    // needs without enumerating them; host allowlists are ignored by
    // browsers that honour it, which is the intent.
    // 'unsafe-eval' is dev-only: React uses eval to rebuild server error
    // stacks in the browser. Neither React nor Next need it in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // See the header comment — required by Leaflet and React inline styles.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://*.supabase.co ${MAP_IMAGE_ORIGINS.join(" ")}`,
    // next/font/google self-hosts at build time, so no Google origin.
    `font-src 'self'`,
    `connect-src 'self' ${SUPABASE_ORIGINS.join(" ")}${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // PayMongo checkout is a top-level NAVIGATION, not a form post, so it
    // needs no entry here.
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
  ];

  if (!isDev) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/**
 * Headers that need no nonce and no per-request work.
 *
 * HSTS is deliberately absent: Vercel already sets
 * strict-transport-security on this domain, and two sources for one header
 * is how they silently disagree.
 */
export const STATIC_SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  // Stops a browser MIME-sniffing a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // frame-ancestors covers modern browsers; this is the legacy equivalent.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin cross-site, the full path same-site. Booking URLs carry
  // ids that have no business appearing in another site's referer log.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses these; denying them shrinks what injected script can reach.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
];
