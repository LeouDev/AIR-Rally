import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listBookingsForOwner } from "@/lib/services/ownerBookings";
import { OwnerBookingsList } from "@/components/owner/OwnerBookingsList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bookings",
};

export default async function OwnerBookingsPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const { when: rawWhen } = await searchParams;
  const when = rawWhen === "past" ? "past" : "upcoming";

  const user = await requireSignedIn("/list-your-court/bookings");
  const supabase = await createClient();
  const bookings = await listBookingsForOwner(supabase, user.id, when);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reservations across all your venues, grouped by venue and court.</p>
      </div>

      <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1">
        <Link
          href="/list-your-court/bookings?when=upcoming"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            when === "upcoming" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Upcoming
        </Link>
        <Link
          href="/list-your-court/bookings?when=past"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            when === "past" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Past
        </Link>
      </div>

      <OwnerBookingsList bookings={bookings} />
    </div>
  );
}
