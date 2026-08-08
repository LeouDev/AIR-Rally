"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { CourtCard } from "@/components/court/CourtCard";
import { Button } from "@/components/ui/button";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { mockCourts } from "@/lib/mock-data";

export default function FavoritesPage() {
  const favoriteIds = useFavoritesStore((s) => s.courtIds);
  const favoriteCourts = mockCourts.filter((court) => favoriteIds.includes(court.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Your Favorites</h1>
      <p className="mt-1 text-muted-foreground">Courts you&apos;ve saved for later.</p>

      <div className="mt-8">
        {favoriteCourts.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteCourts.map((court) => (
              <CourtCard key={court.id} court={court} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Heart}
            title="No favorites yet"
            description="Tap the heart icon on any court to save it here for quick access later."
            action={
              <Button asChild>
                <Link href="/explore">Browse Courts</Link>
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
