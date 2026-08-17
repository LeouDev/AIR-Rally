import { Hero } from "@/components/marketing/Hero";
import { FeaturedCourts } from "@/components/marketing/FeaturedCourts";
import { WhyAirRally } from "@/components/marketing/WhyAirRally";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { CtaSection } from "@/components/marketing/CtaSection";
import { AppHome } from "@/components/home/AppHome";
import { getCurrentUser } from "@/lib/supabase/auth";

// FeaturedCourts reads real venues (and, for signed-in visitors, real
// favorite state) via the cookie-aware Supabase server client — merely
// calling cookies() internally is what makes Next treat a route as
// dynamic, so the landing page trades the static caching it had in
// Phase 1/2 for always-current marketplace data. See ARCHITECTURE.md.
export const dynamic = "force-dynamic";

/**
 * Two different jobs behind one URL, the same split /list-your-court already
 * makes for owners who have listed a venue.
 *
 * Signed out, `/` is an acquisition page and stays exactly that — the pitch
 * is the point, and it is what search engines index.
 *
 * Signed in, the pitch has already worked. That visitor came to play: to see
 * their next game, or to find the next one. Selling them the product again
 * pushes both below the fold.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    return <AppHome userId={user.id} />;
  }

  return (
    <>
      <Hero />
      <FeaturedCourts />
      <WhyAirRally />
      <HowItWorks />
      <CtaSection />
    </>
  );
}
