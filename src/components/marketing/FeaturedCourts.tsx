import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { CourtCard } from "@/components/court/CourtCard";
import { Button } from "@/components/ui/button";
import { getFeaturedCourts } from "@/lib/mock-data";

export function FeaturedCourts() {
  const courts = getFeaturedCourts();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Featured"
        title="Popular courts near you"
        description="Highly rated courts booked by players across Cebu and Manila this month."
        action={
          <Button asChild variant="outline">
            <Link href="/explore" className="gap-1.5">
              Browse all courts
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {courts.map((court) => (
          <CourtCard key={court.id} court={court} />
        ))}
      </div>
    </section>
  );
}
