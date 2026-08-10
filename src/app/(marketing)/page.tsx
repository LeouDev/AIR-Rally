import { Hero } from "@/components/marketing/Hero";
import { FeaturedCourts } from "@/components/marketing/FeaturedCourts";
import { WhyAirRally } from "@/components/marketing/WhyAirRally";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { CtaSection } from "@/components/marketing/CtaSection";

// FeaturedCourts reads real venues (and, for signed-in visitors, real
// favorite state) via the cookie-aware Supabase server client — merely
// calling cookies() internally is what makes Next treat a route as
// dynamic, so the landing page trades the static caching it had in
// Phase 1/2 for always-current marketplace data. See ARCHITECTURE.md.
export const dynamic = "force-dynamic";

export default function HomePage() {
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
