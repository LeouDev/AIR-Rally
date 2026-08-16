import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminOwnerApplicationActions } from "@/components/admin/AdminOwnerApplicationActions";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getOwnerApplicationForAdmin } from "@/lib/services/ownerApplications";
import type { OwnerApplicationStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Application Detail" };

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

type AdminOwnerApplicationDetailPageProps = {
  params: Promise<{ applicationId: string }>;
};

export default async function AdminOwnerApplicationDetailPage({ params }: AdminOwnerApplicationDetailPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/owner-applications");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { applicationId } = await params;
  const application = await getOwnerApplicationForAdmin(supabase, applicationId);
  if (!application) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/admin/owner-applications"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to owner applications
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{application.business_name}</h1>
            <Badge className={cn("border-transparent", STATUS_STYLES[application.status])}>
              {STATUS_LABELS[application.status]}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {application.business_phone} · {application.business_email}
          </p>
        </div>
        <AdminOwnerApplicationActions
          applicationId={application.id}
          applicantName={application.business_name}
          status={application.status}
        />
      </div>

      <dl className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Venue</dt>
          <dd className="mt-1 text-foreground">{application.venue_name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Address</dt>
          <dd className="mt-1 text-foreground">
            {application.venue_address}, {application.venue_city}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Courts</dt>
          <dd className="mt-1 text-foreground">{application.court_count}</dd>
        </div>
        {application.venue_description && (
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Description</dt>
            <dd className="mt-1 text-foreground">{application.venue_description}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Submitted</dt>
          <dd className="mt-1 text-foreground">
            {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(application.created_at)
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
