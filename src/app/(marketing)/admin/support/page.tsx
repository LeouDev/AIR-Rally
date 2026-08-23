import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { BackLink } from "@/components/shared/BackLink";
import { SupportStatusButtons } from "@/components/admin/SupportStatusButtons";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listSupportRequests } from "@/lib/services/reports";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/validations/report";
import type { SupportStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support requests" };

const TABS: { value: SupportStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

function parseStatus(value: string | undefined): SupportStatus | "all" {
  return value === "in_progress" || value === "resolved" || value === "closed" || value === "all" ? value : "open";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/support");

  const supabase = await createClient();
  try {
    await requireAdmin(supabase);
  } catch {
    redirect("/");
  }

  const { status: statusParam } = await searchParams;
  const status = parseStatus(statusParam);
  const requests = await listSupportRequests(supabase, status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Support requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages from players and owners. Replies go out as in-app notifications.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/support?status=${tab.value}`}
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

      {requests.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Nothing here" description="Support messages will appear in this queue." />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{SUPPORT_CATEGORY_LABELS[request.category]}</Badge>
                  {request.status !== "open" && <Badge variant="secondary">{request.status.replace("_", " ")}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{formatWhen(request.created_at)}</p>
              </div>

              <p className="mt-3 font-medium text-foreground">{request.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{request.message}</p>

              <p className="mt-3 text-xs text-muted-foreground">From {request.user?.display_name ?? "a player"}</p>

              {request.resolution_note && (
                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-foreground">Your reply</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{request.resolution_note}</p>
                </div>
              )}

              <div className="mt-4">
                <SupportStatusButtons requestId={request.id} status={request.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
