import Link from "next/link";
import { MapPin, Sun, Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Rating } from "@/components/court/Rating";
import { FavoriteButton } from "@/components/court/FavoriteButton";
import { CourtSurface } from "@/components/court/CourtSurface";
import type { Court } from "@/types/court";

type CourtCardProps = {
  court: Court;
};

export function CourtCard({ court }: CourtCardProps) {
  const primaryImage = court.images[0];
  const isIndoor = court.courtType === "indoor";
  const isOutdoor = court.courtType === "outdoor";

  return (
    <Link
      href={`/courts/${court.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <div className="size-full transition-transform duration-300 group-hover:scale-105">
          <CourtSurface surfaceColor={primaryImage.surfaceColor} indoor={primaryImage.indoor} />
        </div>
        <div className="absolute top-3 left-3">
          <Badge variant="secondary" className="gap-1 bg-background/90 text-foreground backdrop-blur">
            {isIndoor ? <Home className="size-3" /> : isOutdoor ? <Sun className="size-3" /> : null}
            {court.courtType === "both" ? "Indoor & Outdoor" : isIndoor ? "Indoor" : "Outdoor"}
          </Badge>
        </div>
        <div className="absolute top-3 right-3">
          <FavoriteButton courtId={court.id} courtName={court.name} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground group-hover:text-primary">
            {court.name}
          </h3>
          <Rating value={court.rating} reviewCount={court.reviewCount} />
        </div>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {court.area}, {court.city}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            <span className="text-base font-semibold text-foreground">₱{court.pricePerHour}</span>{" "}
            / hour
          </p>
          <span className="text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            View court →
          </span>
        </div>
      </div>
    </Link>
  );
}
