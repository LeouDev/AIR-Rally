import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, Home, Sun, Layers, Building2 } from "lucide-react";
import { ImageGallery } from "@/components/court/ImageGallery";
import { AmenityList } from "@/components/court/AmenityList";
import { CourtsSection, type CourtWithThumbnail } from "@/components/court/CourtsSection";
import { OperatingHoursDisplay } from "@/components/court/OperatingHoursDisplay";
import { ReviewPreview } from "@/components/court/ReviewPreview";
import { ReviewForm } from "@/components/court/ReviewForm";
import { Rating } from "@/components/court/Rating";
import { BookingWidget } from "@/components/court/BookingWidget";
import { MobileBookingBar } from "@/components/court/MobileBookingBar";
import { VenueMapLoader } from "@/components/search/VenueMapLoader";
import { GetDirectionsButton } from "@/components/court/GetDirectionsButton";
import { FavoriteButton } from "@/components/court/FavoriteButton";
import { BackButton } from "@/components/shared/BackButton";
import { deterministicSurfaceColor } from "@/components/court/CourtSurface";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getVenueDetail, listOperatingHours } from "@/lib/services/venues";
import { listReviewsByVenue, getReviewEligibility } from "@/lib/services/reviews";
import { isFavorite } from "@/lib/services/favorites";
import { getPublicImageUrl } from "@/lib/services/images";
import { getCourtAvailabilityToday, type CustomerAvailabilitySlot } from "@/lib/services/customerAvailability";
import { todayInTimezone } from "@/lib/services/ownerAvailability";
import type { IndoorOutdoor } from "@/lib/supabase/types";

// Real per-viewer data (favorite state) and real per-request marketplace
// data (rating, reviews) — never statically cached.
export const dynamic = "force-dynamic";

type CourtDetailPageProps = {
  params: Promise<{ id: string }>;
};

const COURT_TYPE_LABEL: Record<IndoorOutdoor, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  both: "Indoor & Outdoor",
};

const COURT_TYPE_ICON = { indoor: Home, outdoor: Sun, both: Layers } as const;

export async function generateMetadata({ params }: CourtDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const venue = await getVenueDetail(supabase, id);
  if (!venue) return {};

  const description = venue.description
    ? venue.description.slice(0, 155)
    : `Book ${venue.name} in ${venue.city ?? "the Philippines"} on Air/Rally.`;

  return { title: venue.name, description };
}

export default async function CourtDetailPage({ params }: CourtDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // getVenueDetail() returns null for "doesn't exist" AND "exists but
  // isn't active" alike (see its doc comment) — a draft venue should look
  // exactly like not-found to a player, never confirm it exists under a
  // different status. A genuine query error throws instead of returning
  // null, and is left to propagate to error.tsx rather than being
  // swallowed into a misleading "not found".
  const venue = await getVenueDetail(supabase, id);
  if (!venue) notFound();

  const [reviews, user, operatingHours] = await Promise.all([
    listReviewsByVenue(supabase, id, 3),
    getCurrentUser(),
    listOperatingHours(supabase, id),
  ]);
  const favorited = user ? await isFavorite(supabase, user.id, id) : false;
  const reviewEligibility = user ? await getReviewEligibility(supabase, user.id, id) : { eligible: false, bookingId: null };

  const TypeIcon = COURT_TYPE_ICON[venue.indoor_outdoor];
  const galleryImages = venue.images.map((image) => ({
    url: getPublicImageUrl(supabase, image.storage_path),
    alt: image.alt_text ?? venue.name,
  }));
  const address = [venue.address, venue.city, venue.state_province, venue.country].filter(Boolean).join(", ");

  // First uploaded photo per court, reusing the images this page already
  // fetched via getVenueDetail() rather than a second image query.
  const courtImageByCourtId = new Map<string, string>();
  for (const image of venue.images) {
    if (image.court_id && !courtImageByCourtId.has(image.court_id)) {
      courtImageByCourtId.set(image.court_id, getPublicImageUrl(supabase, image.storage_path));
    }
  }

  const activeCourts = venue.courts.filter((court) => court.status === "active");
  const courtsWithThumbnail: CourtWithThumbnail[] = activeCourts.map((court) => ({
    ...court,
    imageUrl: courtImageByCourtId.get(court.id) ?? null,
  }));

  // One RPC call per active court, today only — the same customer-safe
  // getAvailableSlots() the booking widget already uses, never the
  // owner-only schedule RPC. See customerAvailability.ts for why.
  const availabilitySlotsByCourt = await Promise.all(
    activeCourts.map((court) => getCourtAvailabilityToday(supabase, court.id, venue.id, venue.timezone))
  );
  const availabilityByCourt: Record<string, CustomerAvailabilitySlot[]> = Object.fromEntries(
    activeCourts.map((court, i) => [court.id, availabilitySlotsByCourt[i]])
  );

  const todayDayOfWeek = new Date(`${todayInTimezone(venue.timezone)}T00:00:00Z`).getUTCDay();

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-32 sm:px-6 lg:px-8 lg:pb-8">
      <BackButton />
      <div className="relative">
        <ImageGallery
          images={galleryImages}
          venueName={venue.name}
          fallbackSurfaceColor={deterministicSurfaceColor(venue.id)}
          indoor={venue.indoor_outdoor === "indoor"}
        />
        <div className="absolute top-3 right-3">
          <FavoriteButton venueId={venue.id} venueName={venue.name} initialFavorited={favorited} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{venue.name}</h1>
              <Rating value={venue.average_rating} reviewCount={venue.review_count} size="md" />
            </div>
            {address && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                {address}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoTile icon={TypeIcon} label="Court type" value={COURT_TYPE_LABEL[venue.indoor_outdoor]} />
            <InfoTile icon={Building2} label="Courts" value={String(venue.active_court_count)} />
            {venue.city && <InfoTile icon={MapPin} label="City" value={venue.city} />}
          </div>

          {venue.description && (
            <section>
              <h2 className="text-lg font-semibold text-foreground">About this venue</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{venue.description}</p>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold text-foreground">Courts</h2>
            <div className="mt-3">
              <CourtsSection courts={courtsWithThumbnail} availabilityByCourt={availabilityByCourt} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Amenities</h2>
            <div className="mt-3">
              <AmenityList amenities={venue.amenities} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Hours</h2>
            <div className="mt-3 max-w-sm">
              <OperatingHoursDisplay operatingHours={operatingHours} todayDayOfWeek={todayDayOfWeek} />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Location</h2>
              <GetDirectionsButton latitude={venue.latitude} longitude={venue.longitude} venueName={venue.name} />
            </div>
            <div className="mt-3 h-64">
              <VenueMapLoader
                markers={
                  venue.latitude !== null && venue.longitude !== null
                    ? [{ id: venue.id, name: venue.name, lat: venue.latitude, lng: venue.longitude, href: `/courts/${venue.id}`, price: venue.starting_price }]
                    : []
                }
                className="h-64"
              />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Reviews</h2>
              <Rating value={venue.average_rating} reviewCount={venue.review_count} />
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {reviews.length > 0 ? (
                reviews.map((review) => <ReviewPreview key={review.id} review={review} />)
              ) : (
                <p className="text-sm text-muted-foreground">No reviews yet — be the first to play here.</p>
              )}
            </div>
            {reviewEligibility.eligible && reviewEligibility.bookingId && (
              <div className="mt-4">
                <ReviewForm venueId={venue.id} bookingId={reviewEligibility.bookingId} />
              </div>
            )}
          </section>
        </div>

        <div className="hidden lg:col-span-1 lg:block">
          <div className="lg:sticky lg:top-24">
            <BookingWidget
              venueName={venue.name}
              venueTimezone={venue.timezone}
              courts={venue.courts}
              phone={venue.phone}
              email={venue.email}
              isAuthenticated={user !== null}
            />
          </div>
        </div>
      </div>

      {venue.courts.length > 0 && (
        <MobileBookingBar
          startingPrice={venue.starting_price}
          venueName={venue.name}
          venueTimezone={venue.timezone}
          courts={venue.courts}
          phone={venue.phone}
          email={venue.email}
          isAuthenticated={user !== null}
        />
      )}
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
