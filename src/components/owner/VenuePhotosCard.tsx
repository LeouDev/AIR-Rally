import { ImageUploadManager } from "@/components/owner/ImageUploadManager";
import type { CourtImage } from "@/lib/supabase/types";

export function VenuePhotosCard({ venueId, images }: { venueId: string; images: CourtImage[] }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Venue Photos</h2>
        <p className="text-sm text-muted-foreground">
          The first photo becomes your venue&apos;s cover image on the marketplace. Add a few more to show players
          around.
        </p>
      </div>
      <ImageUploadManager venueId={venueId} courtId={null} images={images} />
    </div>
  );
}
