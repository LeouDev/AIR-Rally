import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Rating } from "@/components/court/Rating";
import { ReviewPreview } from "@/components/court/ReviewPreview";
import { AdminVenueStatusActions } from "@/components/admin/AdminVenueStatusActions";
import { AdminDeleteReviewButton } from "@/components/admin/AdminDeleteReviewButton";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getVenueForAdmin } from "@/lib/services/venues";
import type { VenueStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue Detail" };

const STATUS_STYLES: Record<VenueStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-warning/15 text-warning",
  active: "bg-success/15 text-success",
  suspended: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<VenueStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  active: "Active",
  suspended: "Suspended",
  archived: "Archived",
};

type AdminVenueDetailPageProps = {
  params: Promise<{ venueId: string }>;
};

export default async function AdminVenueDetailPage({ params }: AdminVenueDetailPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/venues");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { venueId } = await params;
  const venue = await getVenueForAdmin(supabase, venueId);
  if (!venue) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Link href="/admin/venues" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to venue management
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{venue.name}</h1>
            <Badge className={cn("border-transparent", STATUS_STYLES[venue.status])}>{STATUS_LABELS[venue.status]}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {venue.ownerDisplayName ?? "Unknown owner"} · {[venue.address, venue.city].filter(Boolean).join(", ") || "No address set"}
          </p>
          {venue.average_rating > 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Rating value={venue.average_rating} />
              <span className="text-muted-foreground">
                {venue.average_rating.toFixed(1)} · {venue.review_count} {venue.review_count === 1 ? "review" : "reviews"}
              </span>
            </div>
          )}
        </div>
        <AdminVenueStatusActions venueId={venue.id} venueName={venue.name} status={venue.status} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">Courts ({venue.courts.length})</h2>
        {venue.courts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No courts added yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {venue.courts.map((court) => (
              <li key={court.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
                <span className="text-foreground">{court.name}</span>
                <span className="text-muted-foreground">{court.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">Recent reviews</h2>
        {venue.recentReviews.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {venue.recentReviews.map((review) => (
              <li key={review.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <ReviewPreview review={review} />
                </div>
                <AdminDeleteReviewButton reviewId={review.id} venueId={venue.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
