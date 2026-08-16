import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getReferralFunnelStats } from "@/lib/services/referralAnalytics";

// Live admin view over real referral state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Referral Funnel" };

const STAGES: { key: "sent" | "started" | "completed" | "approved"; label: string; description: string }[] = [
  { key: "sent", label: "Sent", description: "Invite shared, not yet acted on" },
  { key: "started", label: "Started", description: "Began an owner application" },
  { key: "completed", label: "Completed", description: "Submitted the full application" },
  { key: "approved", label: "Approved", description: "Approved as a venue owner" },
];

export default async function AdminReferralsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/referrals");
  }

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const stats = await getReferralFunnelStats(supabase);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Referral Funnel</h1>
      <p className="mt-1 text-muted-foreground">How owner referrals progress from invite to approved venue owner.</p>

      <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAGES.map((stage) => (
          <div key={stage.key} className="rounded-2xl border border-border bg-card p-6">
            <dt className="text-xs font-medium uppercase text-muted-foreground">{stage.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-foreground">{stats[stage.key]}</dd>
            <p className="mt-1 text-xs text-muted-foreground">{stage.description}</p>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-xs font-medium uppercase text-muted-foreground">Total referrals</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-xs font-medium uppercase text-muted-foreground">Invite → approved</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{(stats.conversionRate * 100).toFixed(0)}%</p>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Tracking begins when a referral is recorded — anonymous link visits are not logged, so there is no click-through
        stage here.
      </p>
    </div>
  );
}
