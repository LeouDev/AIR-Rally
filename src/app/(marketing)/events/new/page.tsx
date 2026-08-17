import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listHostableBookings } from "@/lib/services/events";
import { CreateOpenPlayForm } from "@/components/events/CreateOpenPlayForm";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start a game" };

export default async function NewOpenPlayPage() {
  const user = await requireSignedIn("/events/new");
  const supabase = await createClient();
  const bookings = await listHostableBookings(supabase, user.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <BackLink href="/events" label="Back to open play" />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Start a game</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite your playmates to a court you&apos;ve booked. You pay the venue; splitting it is between you and them.
        </p>
      </div>

      <CreateOpenPlayForm bookings={bookings} />
    </div>
  );
}
