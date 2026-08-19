import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { listActiveVenueIdsForSitemap } from "@/lib/services/venues";
import { logServerError } from "@/lib/errors";

/**
 * Every public, indexable URL on the site: the static marketing pages
 * plus one entry per active venue (the actual product content — a
 * player's real reason to be here). Deliberately excludes clubs and
 * events for now: neither has a verified "safe to list publicly"
 * query yet (a club/event's moderation status isn't something this file
 * should guess at), so they're left out rather than risking a
 * pending/rejected one appearing in a public sitemap. Add them once that
 * query exists.
 *
 * The venue lookup is wrapped in its own try/catch: a transient DB
 * failure should degrade to "the sitemap is missing some venues" rather
 * than "the sitemap 500s and crawlers get nothing at all."
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = await getSiteUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/explore`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/how-it-works`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/list-your-court`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/owner-agreement`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/support`, changeFrequency: "yearly", priority: 0.3 },
  ];

  let venueRoutes: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const venues = await listActiveVenueIdsForSitemap(supabase);
    venueRoutes = venues.map((venue) => ({
      url: `${siteUrl}/courts/${venue.id}`,
      lastModified: venue.createdAt,
      changeFrequency: "daily",
      priority: 0.8,
    }));
  } catch (error) {
    logServerError("sitemap.listActiveVenues", error);
  }

  return [...staticRoutes, ...venueRoutes];
}
