import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { CourtCard } from "@/components/court/CourtCard";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listFeaturedVenues } from "@/lib/services/venues";
import { listFavoriteVenueIds } from "@/lib/services/favorites";
import { toVenueCardData } from "@/lib/services/exploreCards";

export async function FeaturedCourts() {
  const supabase = await createClient();
  const [venues, user] = await Promise.all([listFeaturedVenues(supabase, 6), getCurrentUser()]);

  if (venues.length === 0) {
    return null;
  }

  const favoritedIds = user ? new Set(await listFavoriteVenueIds(supabase, user.id)) : new Set<string>();
  const cards = await toVenueCardData(supabase, venues);

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Featured"
        title="Popular courts near you"
        description="Highly rated courts on Air/Rally."
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
        {cards.map((venue) => (
          <CourtCard key={venue.id} venue={venue} isFavorited={favoritedIds.has(venue.id)} />
        ))}
      </div>
    </section>
  );
}
