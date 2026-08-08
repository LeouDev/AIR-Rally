import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Bookings" };

export default function BookingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Your Bookings</h1>
      <p className="mt-1 text-muted-foreground">Reservations you make will show up here.</p>

      <div className="mt-8">
        <EmptyState
          icon={CalendarCheck}
          title="No bookings yet"
          description="Once you reserve a court, you'll be able to track upcoming and past sessions here."
          action={
            <Button asChild>
              <Link href="/explore">Find a Court</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
