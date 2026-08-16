import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OwnerAvailabilityCalendar } from "@/components/owner/OwnerAvailabilityCalendar";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getVenueForOwner, listOperatingHours } from "@/lib/services/venues";
import { listCourtsByVenue } from "@/lib/services/courts";
import { getOwnerCourtSchedule, mergeWithClosedSlots, todayInTimezone, type MergedSlot } from "@/lib/services/ownerAvailability";

// Reads real-time bookings/blocks for the owner's own venue — never
// cacheable, same posture as the parent venue-management page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Availability Calendar",
};

export default async function VenueAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { venueId } = await params;
  const { date: requestedDate } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirect=/list-your-court/${venueId}/availability`);
  }

  const supabase = await createClient();

  // Same "doesn't exist and not owned look identical" posture as the
  // parent venue-management page's own getVenueForOwner() guard.
  const venue = await getVenueForOwner(supabase, venueId);
  if (!venue) notFound();

  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayInTimezone(venue.timezone);
  // `date` is a plain local calendar date, not an instant — parse as UTC
  // so the day-of-week doesn't depend on the server's own timezone.
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

  const [courts, operatingHours] = await Promise.all([listCourtsByVenue(supabase, venueId), listOperatingHours(supabase, venueId)]);
  const schedules = await Promise.all(courts.map((court) => getOwnerCourtSchedule(supabase, court.id, date)));
  const schedulesByCourt = Object.fromEntries(
    courts.map((court, i) => [court.id, mergeWithClosedSlots(schedules[i], operatingHours, dayOfWeek, venue.timezone)])
  ) as Record<string, MergedSlot[]>;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <Link
          href={`/list-your-court/${venueId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to {venue.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Availability Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See what&apos;s booked, blocked, or open across your courts, and block time for maintenance or private use.
        </p>
      </div>

      <OwnerAvailabilityCalendar venueId={venueId} date={date} courts={courts} schedulesByCourt={schedulesByCourt} />
    </div>
  );
}
