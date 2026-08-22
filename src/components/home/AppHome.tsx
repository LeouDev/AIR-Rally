import { SearchBar } from "@/components/search/SearchBar";
import { QuickFilters } from "@/components/search/QuickFilters";
import { FeaturedCourts } from "@/components/marketing/FeaturedCourts";
import { UpcomingBookingCard } from "@/components/home/UpcomingBookingCard";
import { CourtSideTeaser } from "@/components/home/CourtSideTeaser";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/profiles";
import { listMyBookingsWithDetails } from "@/lib/services/bookings";
import { listFeedPosts } from "@/lib/services/posts";
import { nextUpcomingBooking } from "@/lib/upcomingBookings";

function firstName(displayName: string | null | undefined): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

export async function AppHome({ userId }: { userId: string }) {
  const supabase = await createClient();

  const [profile, bookings, feed] = await Promise.all([
    getProfile(supabase, userId),
    listMyBookingsWithDetails(supabase, userId),
    listFeedPosts(supabase, { scope: "for_you", limit: 1 }),
  ]);

  const upcoming = nextUpcomingBooking(bookings);
  const name = firstName(profile?.display_name);

  return (
    <>
      {/* Navy band: the greeting and the one thing this screen is for. */}
      <section className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pt-8 pb-7 sm:px-6 lg:px-8">
          <h1 className="text-[1.75rem]/[2.125rem] font-semibold tracking-[-0.02em] text-balance">
            {name ? `Kumusta, ${name}.` : "Kumusta."}
            <br />
            Where are we playing?
          </h1>
          <SearchBar />
        </div>
      </section>

      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-7 sm:px-6 lg:px-8">
        {upcoming && <UpcomingBookingCard booking={upcoming} />}
        <QuickFilters />
      </div>

      <FeaturedCourts />

      <div className="mx-auto max-w-4xl px-4 pb-14 sm:px-6 lg:px-8">
        <CourtSideTeaser post={feed.posts[0] ?? null} />
      </div>
    </>
  );
}
