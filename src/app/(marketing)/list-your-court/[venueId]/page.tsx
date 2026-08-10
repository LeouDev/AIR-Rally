import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { VenueForm } from "@/components/owner/VenueForm";
import { VenueAmenitiesEditor } from "@/components/owner/VenueAmenitiesEditor";
import { CourtsManager } from "@/components/owner/CourtsManager";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getVenueForOwner } from "@/lib/services/venues";
import { listCourtsByVenue } from "@/lib/services/courts";
import { listAmenities, listAmenityIdsForVenue } from "@/lib/services/amenities";
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

  const [courts, allAmenities, selectedAmenityIds] = await Promise.all([
    listCourtsByVenue(supabase, venueId),
    listAmenities(supabase),
    listAmenityIdsForVenue(supabase, venueId),
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{venue.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your venue details, amenities, and courts.
        </p>
      </div>

      <VenueForm mode="edit" venueId={venueId} initialValues={initialValues} />
      <VenueAmenitiesEditor venueId={venueId} allAmenities={allAmenities} initialSelectedIds={selectedAmenityIds} />
      <CourtsManager venueId={venueId} courts={courts} />
    </div>
  );
}
