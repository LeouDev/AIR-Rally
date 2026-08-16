import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { AdminOwnerApplicationActions } from "@/components/admin/AdminOwnerApplicationActions";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listOwnerApplicationsForAdmin } from "@/lib/services/ownerApplications";
import type { OwnerApplicationStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Live admin view over real application state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Owner Applications" };

const TABS: { value: OwnerApplicationStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const STATUS_STYLES: Record<OwnerApplicationStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<OwnerApplicationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

type AdminOwnerApplicationsPageProps = {
  searchParams: Promise<{ status?: string }>;
};

function isApplicationStatus(value: string): value is OwnerApplicationStatus {
  return value in STATUS_LABELS;
}

function parseTab(value: string | undefined): OwnerApplicationStatus | "all" {
  if (value === "all") return "all";
  if (value && isApplicationStatus(value)) return value;
  return "pending";
}

export default async function AdminOwnerApplicationsPage({ searchParams }: AdminOwnerApplicationsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/owner-applications");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { status: rawStatus } = await searchParams;
  const activeTab = parseTab(rawStatus);

  const applications = await listOwnerApplicationsForAdmin(supabase, activeTab === "all" ? undefined : activeTab);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Owner Applications</h1>
      <p className="mt-1 text-muted-foreground">Review and approve venue owner applications.</p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "pending" ? "/admin/owner-applications" : `/admin/owner-applications?status=${tab.value}`}
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

      {applications.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No applications in this view.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {applications.map((application) => (
            <li
              key={application.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/owner-applications/${application.id}`} className="font-medium text-foreground hover:underline">
                    {application.business_name}
                  </Link>
                  <Badge className={cn("border-transparent", STATUS_STYLES[application.status])}>
                    {STATUS_LABELS[application.status]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {application.venue_name} · {application.venue_city} · {application.court_count}{" "}
                  {application.court_count === 1 ? "court" : "courts"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/admin/owner-applications/${application.id}`}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  View details
                </Link>
                <AdminOwnerApplicationActions
                  applicationId={application.id}
                  applicantName={application.business_name}
                  status={application.status}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
