import { Hero } from "@/components/marketing/Hero";
import { FeaturedCourts } from "@/components/marketing/FeaturedCourts";
import { WhyAirRally } from "@/components/marketing/WhyAirRally";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { CtaSection } from "@/components/marketing/CtaSection";

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
