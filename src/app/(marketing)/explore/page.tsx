import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { searchMarketplaceVenues } from "@/lib/services/venues";
import { listAmenities } from "@/lib/services/amenities";
import { listFavoriteVenueIds } from "@/lib/services/favorites";
import { getPublicImageUrl } from "@/lib/services/images";
import { parseExploreFilters, filtersToSearchParams, type ExploreSearchParams } from "@/lib/explore-params";
import { SearchBar } from "@/components/search/SearchBar";
import { MarketplaceSearchInput } from "@/components/search/MarketplaceSearchInput";
import { ExploreLayout } from "@/components/search/ExploreLayout";
import { ExplorePagination } from "@/components/search/ExplorePagination";
import { MapPlaceholder } from "@/components/search/MapPlaceholder";
import { CourtCard } from "@/components/court/CourtCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchX } from "lucide-react";

export const metadata: Metadata = {
  title: "Explore Courts",
  description: "Search and filter real pickleball courts and venues on Air/Rally.",
};

// Real, per-request search results (and per-viewer favorite state) — this
// page can never be statically cached the way the mock-data version was.
export const dynamic = "force-dynamic";

type ExplorePageProps = {
  searchParams: Promise<ExploreSearchParams>;
};

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const rawParams = await searchParams;
  const filters = parseExploreFilters(rawParams);

  const supabase = await createClient();
  const [searchResult, amenities, user] = await Promise.all([
    searchMarketplaceVenues(supabase, filters),
    listAmenities(supabase),
    getCurrentUser(),
  ]);

  const favoritedIds = user ? new Set(await listFavoriteVenueIds(supabase, user.id)) : new Set<string>();
  const totalPages = Math.max(1, Math.ceil(searchResult.total / searchResult.pageSize));

  const results =
    searchResult.venues.length > 0 ? (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {searchResult.venues.map((venue) => (
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
            isFavorited={favoritedIds.has(venue.id)}
          />
        ))}
      </div>
    ) : (
      <EmptyState
        icon={SearchX}
        title="No courts match your search"
        description="Try a different search term, or widen your filters to see more results."
      />
    );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4">
        <SearchBar variant="compact" />
        <MarketplaceSearchInput className="max-w-md" />
      </div>

      <div className="mt-6">
        <ExploreLayout
          amenities={amenities}
          resultCount={searchResult.total}
          results={results}
          map={<MapPlaceholder className="h-64 lg:h-full" resultCount={searchResult.total} />}
          pagination={
            <ExplorePagination
              page={searchResult.page}
              totalPages={totalPages}
              buildHref={(page) => {
                const params = filtersToSearchParams({ ...filters, page });
                const query = params.toString();
                return query ? `/explore?${query}` : "/explore";
              }}
            />
          }
        />
      </div>
    </div>
  );
}
