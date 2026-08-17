import { buildContentSecurityPolicy, STATIC_SECURITY_HEADERS } from "../csp";

const prod = buildContentSecurityPolicy({ nonce: "TESTNONCE", isDev: false });
const dev = buildContentSecurityPolicy({ nonce: "TESTNONCE", isDev: true });

/** Pulls one directive out of the policy so assertions can't match across directives. */
function directive(policy: string, name: string): string {
  const found = policy.split(";").map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`missing directive: ${name}`);
  return found;
}

describe("buildContentSecurityPolicy — what must NOT be allowed", () => {
  it("never allows inline script, in production or development", () => {
    // THE WHOLE POINT. The Supabase auth cookie is readable by JS, so an
    // injected inline <script> is account takeover. 'unsafe-inline' in
    // script-src would permit exactly that and make this policy theatre.
    expect(directive(prod, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(dev, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows no third-party script origins at all", () => {
    // Audited: the only third-party resources are Leaflet marker IMAGES.
    // If a script origin ever appears here it should be a deliberate,
    // reviewed change rather than something that crept in.
    const scriptSrc = directive(prod, "script-src");
    expect(scriptSrc).toBe("script-src 'self' 'nonce-TESTNONCE' 'strict-dynamic'");
  });

  it("keeps eval out of production, while allowing it in development", () => {
    // React uses eval in dev to rebuild server error stacks. It does not in prod.
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("forbids embedding, plugins and base-tag hijacking", () => {
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
  });
});

describe("buildContentSecurityPolicy — what the app genuinely needs", () => {
  it("carries a nonce that matches the one it was given", () => {
    expect(prod).toContain("'nonce-TESTNONCE'");
  });

  it("allows the map to load, which a naive policy would break", () => {
    // Leaflet fetches tiles from openstreetmap and its marker/shadow icons
    // from unpkg by absolute URL. Without these the map renders blank and
    // markers vanish — the most likely CSP regression in this app.
    const imgSrc = directive(prod, "img-src");
    expect(imgSrc).toContain("https://*.tile.openstreetmap.org");
    expect(imgSrc).toContain("https://unpkg.com");
  });

  it("allows Supabase over both https and websockets", () => {
    const connectSrc = directive(prod, "connect-src");
    expect(connectSrc).toContain("https://*.supabase.co");
    expect(connectSrc).toContain("wss://*.supabase.co");
  });

  it("allows Supabase Storage images and data/blob URLs", () => {
    const imgSrc = directive(prod, "img-src");
    expect(imgSrc).toContain("https://*.supabase.co");
    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
  });

  it("keeps inline styles working — Leaflet and React set style attributes", () => {
    // Deliberate. A nonce does not cover inline style ATTRIBUTES, so a
    // nonce-only style-src blanks the map and breaks the mobile layout.
    expect(directive(prod, "style-src")).toContain("'unsafe-inline'");
  });

  it("self-hosts fonts rather than reaching for Google", () => {
    // next/font/google inlines at build time; a Google origin here would
    // mean something regressed to a runtime fetch.
    expect(directive(prod, "font-src")).toBe("font-src 'self'");
  });

  it("upgrades insecure requests in production only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    // Would break http://localhost during development.
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("allows localhost websockets in development for hot reload", () => {
    expect(directive(dev, "connect-src")).toContain("ws://localhost:*");
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("sets the headers that need no nonce", () => {
    const byKey = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
  });

  it("leaves HSTS to Vercel rather than setting a second source of truth", () => {
    // Vercel already sends strict-transport-security on this domain. Two
    // sources for one header is how they silently disagree.
    expect(STATIC_SECURITY_HEADERS.some((h) => h.key.toLowerCase() === "strict-transport-security")).toBe(false);
  });
});
