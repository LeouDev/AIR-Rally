import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Users, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminClubActions } from "@/components/admin/AdminClubActions";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listClubsForAdmin, getClubModerationCounts } from "@/lib/services/clubs";
import type { Club } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Live moderation state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Community Moderation" };

const TABS: { value: Club["status"] | "all"; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All" },
];

const STATUS_STYLES: Record<Club["status"], string> = {
  pending_review: "bg-warning/15 text-warning",
  active: "bg-success/15 text-success",
  suspended: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<Club["status"], string> = {
  pending_review: "Pending review",
  active: "Active",
  suspended: "Suspended",
};

type PageProps = { searchParams: Promise<{ status?: string }> };

function parseTab(value: string | undefined): Club["status"] | "all" {
  if (value === "all") return "all";
  if (value && value in STATUS_LABELS) return value as Club["status"];
  return "pending_review";
}

export default async function AdminCommunityPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/community");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const activeTab = parseTab((await searchParams).status);
  const [clubs, counts] = await Promise.all([
    listClubsForAdmin(supabase, activeTab === "all" ? undefined : activeTab),
    getClubModerationCounts(supabase),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
        ← Admin dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Community Moderation</h1>
      <p className="mt-1 text-muted-foreground">
        Player-created clubs stay hidden from discovery until they&apos;re approved.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "pending_review" ? "/admin/community" : `/admin/community?status=${tab.value}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.value !== "all" && counts[tab.value] > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">{counts[tab.value]}</span>
            )}
          </Link>
        ))}
      </div>

      {clubs.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No clubs in this view.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {clubs.map((club) => (
            <li key={club.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clubs/${club.id}`} className="font-semibold text-foreground hover:underline">
                      {club.name}
                    </Link>
                    <Badge className={cn("border-transparent", STATUS_STYLES[club.status])}>{STATUS_LABELS[club.status]}</Badge>
                    {club.visibility !== "public" && <Badge variant="outline">{club.visibility.replace("_", " ")}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    by {club.owner?.display_name ?? "Unknown"} ·{" "}
                    {new Date(club.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </p>
                </div>
                <AdminClubActions clubId={club.id} status={club.status} />
              </div>

              {club.description && <p className="text-sm text-muted-foreground">{club.description}</p>}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="size-3" aria-hidden="true" />
                  {club.member_count} {club.member_count === 1 ? "member" : "members"}
                </span>
                {club.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3" aria-hidden="true" />
                    {club.location}
                  </span>
                )}
                <span>{club.skill_level}</span>
                <span>{club.club_type}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
