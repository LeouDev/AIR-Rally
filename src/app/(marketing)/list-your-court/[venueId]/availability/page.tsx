import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OwnerAvailabilityCalendar } from "@/components/owner/OwnerAvailabilityCalendar";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getVenueForOwner } from "@/lib/services/venues";
import { listCourtsByVenue } from "@/lib/services/courts";
import { getOwnerCourtSchedule, type OwnerScheduleSlot } from "@/lib/services/ownerAvailability";

// Reads real-time bookings/blocks for the owner's own venue — never
// cacheable, same posture as the parent venue-management page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Availability Calendar",
};

/** "Today" in the venue's own timezone, not the server's — a venue in Manila and a server running in another region must agree on what day it currently is there. */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

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

  const courts = await listCourtsByVenue(supabase, venueId);
  const schedules = await Promise.all(courts.map((court) => getOwnerCourtSchedule(supabase, court.id, date)));
  const schedulesByCourt = Object.fromEntries(courts.map((court, i) => [court.id, schedules[i]])) as Record<string, OwnerScheduleSlot[]>;

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

      <OwnerAvailabilityCalendar venueId={venueId} date={date} timezone={venue.timezone} courts={courts} schedulesByCourt={schedulesByCourt} />
    </div>
  );
}
