import type { Metadata } from "next";
import { CreateClubForm } from "@/components/clubs/CreateClubForm";
import { requireSignedIn } from "@/lib/supabase/auth";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create a Club" };

export default async function NewClubPage() {
  // Signed-in is the only requirement — deliberately no role check. A
  // player can own a club without becoming a venue owner.
  await requireSignedIn("/clubs/new");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/clubs" label="Back to clubs" />

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Create a club</h1>
      <p className="mt-1 text-muted-foreground">
        Clubs are player-run communities. Anyone can start one — you don&apos;t need to own a venue.
      </p>

      <div className="mt-8">
        <CreateClubForm />
      </div>
    </div>
  );
}
