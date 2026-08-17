import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { AdminVenueStatusActions } from "@/components/admin/AdminVenueStatusActions";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listVenuesForAdmin } from "@/lib/services/venues";
import type { VenueStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/shared/BackLink";

// Live admin view over real venue state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue Management" };

const TABS: { value: VenueStatus | "all"; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All" },
];

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

type AdminVenuesPageProps = {
  searchParams: Promise<{ status?: string }>;
};

function isVenueStatus(value: string): value is VenueStatus {
  return value in STATUS_LABELS;
}

function parseTab(value: string | undefined): VenueStatus | "all" {
  if (value === "all") return "all";
  if (value && isVenueStatus(value)) return value;
  return "pending_review";
}

export default async function AdminVenuesPage({ searchParams }: AdminVenuesPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/venues");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { status: rawStatus } = await searchParams;
  const activeTab = parseTab(rawStatus);

  const venues = await listVenuesForAdmin(supabase, activeTab === "all" ? undefined : activeTab);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-4"><BackLink href="/admin" label="Back to moderation dashboard" /></div>
      <h1 className="text-2xl font-semibold text-foreground">Venue Management</h1>
      <p className="mt-1 text-muted-foreground">Approve new venues, and suspend or reinstate existing ones.</p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "pending_review" ? "/admin/venues" : `/admin/venues?status=${tab.value}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {venues.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No venues in this view.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {venues.map((venue) => (
            <li key={venue.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/venues/${venue.id}`} className="font-medium text-foreground hover:underline">
                    {venue.name}
                  </Link>
                  <Badge className={cn("border-transparent", STATUS_STYLES[venue.status])}>{STATUS_LABELS[venue.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {venue.ownerDisplayName ?? "Unknown owner"} · {venue.city ?? "No city set"} · {venue.courtCount}{" "}
                  {venue.courtCount === 1 ? "court" : "courts"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link href={`/admin/venues/${venue.id}`} className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline">
                  View details
                </Link>
                <AdminVenueStatusActions venueId={venue.id} venueName={venue.name} status={venue.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
