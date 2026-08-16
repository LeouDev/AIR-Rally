"use client";

import { useEffect, useState } from "react";
import { CourtCard, type VenueCardData } from "@/components/court/CourtCard";
import { createClient } from "@/lib/supabase/client";
import { listNearbyVenues } from "@/lib/services/venues";
import { listFavoriteVenueIds } from "@/lib/services/favorites";
import { toVenueCardData } from "@/lib/services/exploreCards";

type FeaturedCourtsGridProps = {
  initialCards: VenueCardData[];
  initialFavoritedIds: string[];
};

/**
 * The server-rendered top-rated venues (passed in as initialCards) are
 * the first paint — fast, no permission prompt, works with JS disabled.
 * On mount, this progressively upgrades to real nearby venues if the
 * visitor grants geolocation. A denial, timeout, or unsupported browser
 * just keeps the server-rendered fallback with no error shown — this is
 * a nice-to-have enhancement, not a requirement to see the section.
 */
export function FeaturedCourtsGrid({ initialCards, initialFavoritedIds }: FeaturedCourtsGridProps) {
  const [cards, setCards] = useState(initialCards);
  const [favoritedIds, setFavoritedIds] = useState(() => new Set(initialFavoritedIds));

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        (async () => {
          try {
            const supabase = createClient();
            const nearby = await listNearbyVenues(supabase, position.coords.latitude, position.coords.longitude, 6);
            if (cancelled || nearby.length === 0) return;

            const [nearbyCards, userResult] = await Promise.all([toVenueCardData(supabase, nearby), supabase.auth.getUser()]);
            if (cancelled) return;

            setCards(nearbyCards);
            const user = userResult.data.user;
            if (user) {
              const ids = await listFavoriteVenueIds(supabase, user.id);
              if (!cancelled) setFavoritedIds(new Set(ids));
            }
          } catch {
            // Best-effort — keep the server-rendered fallback on any failure.
          }
        })();
      },
      () => {
        // Denied/unavailable — keep the server-rendered fallback.
      },
      { timeout: 5000, maximumAge: 300_000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (cards.length === 0) return null;

  return (
    <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((venue) => (
        <CourtCard key={venue.id} venue={venue} isFavorited={favoritedIds.has(venue.id)} />
      ))}
    </div>
  );
}
