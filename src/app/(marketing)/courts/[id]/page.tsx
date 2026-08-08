import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, Home, Sun, Layers, Building2 } from "lucide-react";
import { ImageGallery } from "@/components/court/ImageGallery";
import { AmenityList } from "@/components/court/AmenityList";
import { ReviewPreview } from "@/components/court/ReviewPreview";
import { Rating } from "@/components/court/Rating";
import { BookingPanel } from "@/components/court/BookingPanel";
import { MapPlaceholder } from "@/components/search/MapPlaceholder";
import { getCourtById, getAmenitiesByIds, getReviewsByCourtId, mockCourts } from "@/lib/mock-data";

type CourtDetailPageProps = {
  params: Promise<{ id: string }>;
};

const COURT_TYPE_LABEL: Record<string, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  both: "Indoor & Outdoor",
};

const COURT_TYPE_ICON = { indoor: Home, outdoor: Sun, both: Layers } as const;

export async function generateMetadata({ params }: CourtDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const court = getCourtById(id);
  if (!court) return {};
  return {
    title: court.name,
    description: court.tagline,
  };
}

export function generateStaticParams() {
  return mockCourts.map((court) => ({ id: court.id }));
}

export default async function CourtDetailPage({ params }: CourtDetailPageProps) {
  const { id } = await params;
  const court = getCourtById(id);
  if (!court) notFound();

  const amenities = getAmenitiesByIds(court.amenityIds);
  const reviews = getReviewsByCourtId(court.id).slice(0, 3);
  const TypeIcon = COURT_TYPE_ICON[court.courtType];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ImageGallery images={court.images} courtName={court.name} />

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{court.name}</h1>
                <p className="mt-1 text-muted-foreground">{court.tagline}</p>
              </div>
              <Rating value={court.rating} reviewCount={court.reviewCount} size="md" />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {court.address}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoTile icon={TypeIcon} label="Court type" value={COURT_TYPE_LABEL[court.courtType]} />
            <InfoTile icon={Building2} label="Courts" value={String(court.numberOfCourts)} />
            <InfoTile icon={Layers} label="Surface" value={court.surfaceType} />
            <InfoTile icon={MapPin} label="Area" value={court.area} />
          </div>

          <section>
            <h2 className="text-lg font-semibold text-foreground">About this venue</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{court.description}</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Amenities</h2>
            <div className="mt-3">
              <AmenityList amenities={amenities} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Location</h2>
            <div className="mt-3 h-64">
              <MapPlaceholder />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Reviews</h2>
              <Rating value={court.rating} reviewCount={court.reviewCount} />
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {reviews.length > 0 ? (
                reviews.map((review) => <ReviewPreview key={review.id} review={review} />)
              ) : (
                <p className="text-sm text-muted-foreground">No reviews yet — be the first to play here.</p>
              )}
            </div>
          </section>
        </div>

        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-24">
            <BookingPanel court={court} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3 py-3">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
