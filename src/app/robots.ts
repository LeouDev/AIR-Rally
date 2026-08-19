import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

/**
 * Generated rather than a static robots.txt, so it always points crawlers
 * at the correct sitemap host for wherever this actually deployed (see
 * getSiteUrl()) — a hardcoded production URL here would be wrong on every
 * preview deployment.
 *
 * Disallowed paths are exactly the ones a live-site audit confirmed
 * redirect an unauthenticated visitor away before rendering any content
 * (proxy.ts's own PROTECTED_PREFIXES, plus /admin and the owner dashboard
 * sub-routes under /list-your-court, which redirect at the page level —
 * see requireAdmin()/getCurrentUser() checks in those routes). Never
 * listing a path here that hasn't actually been confirmed protected,
 * since an over-eager Disallow silently drops real content from search
 * results with no error to notice it by.
 *
 * /list-your-court itself (the public "become an owner" landing page) is
 * deliberately NOT disallowed — only its dashboard sub-paths are, hence
 * the trailing slash on that one entry.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteUrl = await getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/auth/", "/bookings", "/favorites", "/profile", "/list-your-court/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
