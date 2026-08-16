import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VenueForm } from "@/components/owner/VenueForm";
import { VenueAmenitiesEditor } from "@/components/owner/VenueAmenitiesEditor";
import { VenueOperatingHoursEditor } from "@/components/owner/VenueOperatingHoursEditor";
import { VenueReadinessChecklist } from "@/components/owner/VenueReadinessChecklist";
import { CourtsManager } from "@/components/owner/CourtsManager";
import { PaymongoOnboardingCard } from "@/components/owner/PaymongoOnboardingCard";
import { VenueEarningsCard } from "@/components/owner/VenueEarningsCard";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getVenueForOwner, listOperatingHours } from "@/lib/services/venues";
import { listCourtsByVenue } from "@/lib/services/courts";
import { listAmenities, listAmenityIdsForVenue } from "@/lib/services/amenities";
import { getVenueReadiness } from "@/lib/services/venueReadiness";
import { getVenueEarnings } from "@/lib/services/venueEarnings";
import type { CreateVenueDraftValues } from "@/lib/validations/venue";

// Reads the owner's own venue via a cookie-scoped session and RLS — never
// cacheable across visitors.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage Venue",
};

export default async function ManageVenuePage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirect=/list-your-court/${venueId}`);
  }

  const supabase = await createClient();

  // getVenueForOwner returns null both when the venue doesn't exist and
  // when RLS hides it because this user isn't the owner — indistinguishable
  // by design, same as the public venue-detail 404.
  const venue = await getVenueForOwner(supabase, venueId);
  if (!venue) notFound();

  const [courts, allAmenities, selectedAmenityIds, operatingHours, readiness, earnings] = await Promise.all([
    listCourtsByVenue(supabase, venueId),
    listAmenities(supabase),
    listAmenityIdsForVenue(supabase, venueId),
    listOperatingHours(supabase, venueId),
    getVenueReadiness(supabase, venueId),
    getVenueEarnings(supabase, venueId),
  ]);

  const initialValues: CreateVenueDraftValues = {
    name: venue.name,
    description: venue.description ?? "",
    address: venue.address ?? "",
    city: venue.city ?? "",
    stateProvince: venue.state_province ?? "",
    country: venue.country ?? "",
    phone: venue.phone ?? "",
    email: venue.email ?? "",
    website: venue.website ?? "",
    indoorOutdoor: venue.indoor_outdoor,
    numberOfCourts: venue.number_of_courts,
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{venue.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your venue details, amenities, and courts.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-1.5">
          <Link href={`/list-your-court/${venueId}/availability`}>
            <CalendarClock className="size-4" />
            Availability Calendar
          </Link>
        </Button>
      </div>

      <VenueReadinessChecklist readiness={readiness} />
      <VenueEarningsCard earnings={earnings} />
      <VenueForm mode="edit" venueId={venueId} initialValues={initialValues} />
      <PaymongoOnboardingCard
        venueId={venueId}
        activationStatus={venue.paymongo_activation_status}
        declinedReason={venue.paymongo_declined_reason}
      />
      <VenueAmenitiesEditor venueId={venueId} allAmenities={allAmenities} initialSelectedIds={selectedAmenityIds} />
      <VenueOperatingHoursEditor venueId={venueId} initialHours={operatingHours} />
      <CourtsManager venueId={venueId} courts={courts} />
    </div>
  );
}
