import type { Metadata } from "next";
import { Bell, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listMySupportRequests } from "@/lib/services/reports";
import { SupportForm } from "@/components/trust/SupportForm";
import type { SupportStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support" };

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "Being looked at",
  resolved: "Resolved",
  closed: "Closed",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default async function SupportPage() {
  const user = await requireSignedIn("/support");
  const supabase = await createClient();
  const requests = await listMySupportRequests(supabase, user.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Get help</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us what&apos;s going on and we&apos;ll look into it.
        </p>
      </div>

      {/* Stated plainly rather than implied. There is no email
          infrastructure, so promising a reply to an inbox would be a
          promise the platform cannot keep. */}
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        We reply in your AIR/Rally notifications, not by email. Check the bell in the top bar.
      </p>

      <SupportForm />

      {requests.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">Your previous messages</h2>
          <ul className="flex flex-col gap-2">
            {requests.map((request) => (
              <li key={request.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{request.subject}</p>
                  <Badge variant={request.status === "open" ? "outline" : "secondary"}>
                    {STATUS_LABELS[request.status]}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{request.message}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3" aria-hidden="true" />
                  {formatWhen(request.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
