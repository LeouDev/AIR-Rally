import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Flag, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { BackLink } from "@/components/shared/BackLink";
import { ResolveReportButtons } from "@/components/admin/ResolveReportButtons";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listReports, describeReportTarget } from "@/lib/services/reports";
import { REPORT_REASON_LABELS } from "@/lib/validations/report";
import type { ReportStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

const TABS: { value: ReportStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

function parseStatus(value: string | undefined): ReportStatus | "all" {
  return value === "reviewed" || value === "dismissed" || value === "all" ? value : "open";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/reports");

  const supabase = await createClient();
  // Fast, clear failure. The real boundary is the reports SELECT policy,
  // which only returns other people's reports to an admin.
  try {
    await requireAdmin(supabase);
  } catch {
    redirect("/");
  }

  const { status: statusParam } = await searchParams;
  const status = parseStatus(statusParam);
  const reports = await listReports(supabase, status);

  // Resolved in parallel; each returns null when the reported thing has
  // since been deleted, which is a normal state rather than an error —
  // reports deliberately outlive their targets.
  const targets = await Promise.all(reports.map((r) => describeReportTarget(supabase, r.target_type, r.target_id)));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What players have flagged across posts, clubs, events and accounts.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/reports?status=${tab.value}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              status === tab.value
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={status === "open" ? "Nothing to review" : "No reports here"}
          description={
            status === "open"
              ? "When someone reports a post, club, event or player, it lands here."
              : "Try a different filter."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report, i) => {
            const target = targets[i];
            return (
              <li key={report.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {report.target_type}
                    </Badge>
                    <Badge className="border-transparent bg-accent text-accent-foreground">
                      {REPORT_REASON_LABELS[report.reason]}
                    </Badge>
                    {report.status !== "open" && (
                      <Badge variant="secondary">{report.status === "reviewed" ? "Actioned" : "Dismissed"}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatWhen(report.created_at)}</p>
                </div>

                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                  {target ? (
                    <>
                      <p className="text-sm text-foreground">{target.label}</p>
                      {target.href && (
                        <Link href={target.href} className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
                          Open it →
                        </Link>
                      )}
                    </>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
                      No longer available — it was deleted after this was reported.
                    </p>
                  )}
                </div>

                {report.details && <p className="mt-3 text-sm text-muted-foreground">“{report.details}”</p>}

                <p className="mt-3 text-xs text-muted-foreground">
                  Reported by {report.reporter?.display_name ?? "a player"}
                </p>

                {report.status === "open" && (
                  <div className="mt-4">
                    <ResolveReportButtons reportId={report.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
