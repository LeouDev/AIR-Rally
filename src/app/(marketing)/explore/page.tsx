import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { searchMarketplaceVenues, listSurfaceTypes } from "@/lib/services/venues";
import { listAmenities } from "@/lib/services/amenities";
import { listFavoriteVenueIds } from "@/lib/services/favorites";
import { toVenueCardData } from "@/lib/services/exploreCards";
import { parseExploreFilters, filtersToSearchParams, type ExploreSearchParams } from "@/lib/explore-params";
import { SearchBar } from "@/components/search/SearchBar";
import { MarketplaceSearchInput } from "@/components/search/MarketplaceSearchInput";
import { ExploreLayout } from "@/components/search/ExploreLayout";
import { ExplorePagination } from "@/components/search/ExplorePagination";
import { CourtCard } from "@/components/court/CourtCard";
import { NoResultsState } from "@/components/search/NoResultsState";

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
  const [searchResult, amenities, surfaceTypes, user] = await Promise.all([
    searchMarketplaceVenues(supabase, filters),
    listAmenities(supabase),
    listSurfaceTypes(supabase),
    getCurrentUser(),
  ]);

  // Both depend on the wave above and neither on the other, so they run
  // together rather than one after the other — a second round-trip to the
  // database is worth more than the line saved by awaiting in sequence.
  const [favoriteIds, cards] = await Promise.all([
    user ? listFavoriteVenueIds(supabase, user.id) : Promise.resolve([]),
    toVenueCardData(supabase, searchResult.venues),
  ]);

  const favoritedIds = new Set(favoriteIds);
  const totalPages = Math.max(1, Math.ceil(searchResult.total / searchResult.pageSize));

  const results =
    cards.length > 0 ? (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((venue) => (
          <CourtCard key={venue.id} venue={venue} isFavorited={favoritedIds.has(venue.id)} />
        ))}
      </div>
    ) : (
      <NoResultsState amenities={amenities} isSignedIn={Boolean(user)} />
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
          surfaceTypes={surfaceTypes}
          resultCount={searchResult.total}
          results={results}
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
