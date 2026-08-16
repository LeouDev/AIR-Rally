import Link from "next/link";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { CourtCard } from "@/components/court/CourtCard";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { listFavoritedVenues } from "@/lib/services/venues";
import { getPublicImageUrl } from "@/lib/services/images";

export const metadata = { title: "Favorites" };
// Real, per-user data — proxy.ts already redirects unauthenticated
// visitors to /login before this ever renders, but the fetch itself is
// still cookie-scoped and can't be cached across visitors regardless.
export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const venues = user ? await listFavoritedVenues(supabase, user.id) : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Your Favorites</h1>
      <p className="mt-1 text-muted-foreground">Courts you&apos;ve saved for later.</p>

      <div className="mt-8">
        {venues.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((venue) => (
              <CourtCard
                key={venue.id}
                venue={{
                  id: venue.id,
                  name: venue.name,
                  city: venue.city,
                  indoorOutdoor: venue.indoor_outdoor,
                  averageRating: venue.average_rating,
                  reviewCount: venue.review_count,
                  startingPrice: venue.starting_price,
                  coverImageUrl: venue.cover_image_path ? getPublicImageUrl(supabase, venue.cover_image_path) : null,
                }}
                isFavorited
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Heart}
            title="Your favorite courts will appear here"
            description="Tap the heart icon on any court to save it here for quick access later."
            action={
              <Button asChild>
                <Link href="/explore">Find a Court</Link>
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
