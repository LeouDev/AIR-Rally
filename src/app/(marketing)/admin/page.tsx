import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Building2, Users, ClipboardCheck, CreditCard, Share2, Wallet, Landmark } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getClubModerationCounts } from "@/lib/services/clubs";
import { listVenuesForAdmin } from "@/lib/services/venues";
import { listOwnerApplicationsForAdmin } from "@/lib/services/ownerApplications";
import { getAdminSettlementSummary } from "@/lib/services/settlements";

// Live counts across every moderation queue — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [clubCounts, pendingVenues, pendingApplications, settlementSummary] = await Promise.all([
    getClubModerationCounts(supabase),
    listVenuesForAdmin(supabase, "pending_review"),
    listOwnerApplicationsForAdmin(supabase, "pending"),
    getAdminSettlementSummary(supabase),
  ]);
  const onHoldSettlements = settlementSummary.onHoldCount;

  // Only the queues that actually need attention carry a count — a badge
  // on a zero is noise.
  const cards = [
    {
      href: "/admin/venues",
      icon: Building2,
      title: "Venues",
      description: "Approve or suspend venue listings.",
      pending: pendingVenues.length,
    },
    {
      href: "/admin/community",
      icon: Users,
      title: "Clubs",
      description: "Approve player-created clubs before they go public.",
      pending: clubCounts.pending_review,
    },
    {
      href: "/admin/owner-applications",
      icon: ClipboardCheck,
      title: "Owner applications",
      description: "Decide who becomes a venue owner.",
      pending: pendingApplications.length,
    },
    {
      href: "/admin/payments",
      icon: CreditCard,
      title: "Payments",
      description: "Monitor bookings, payments, and refunds.",
      pending: 0,
    },
    {
      href: "/admin/settlements",
      icon: Wallet,
      title: "Settlements",
      description: "What venues are owed, and the platform's cash exposure.",
      // On-hold settlements are the only ones needing a human decision.
      pending: onHoldSettlements,
    },
    {
      href: "/admin/finance",
      icon: Landmark,
      title: "Finance",
      description: "Payout readiness, cash position, and payout batches.",
      pending: 0,
    },
    {
      href: "/admin/referrals",
      icon: Share2,
      title: "Referrals",
      description: "Owner referral funnel, invite through approval.",
      pending: 0,
    },
  ];

  const totalPending = pendingVenues.length + clubCounts.pending_review + pendingApplications.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Moderation dashboard</h1>
      <p className="mt-1 text-muted-foreground">
        {totalPending === 0
          ? "Everything is reviewed — nothing is waiting on you."
          : `${totalPending} item${totalPending === 1 ? "" : "s"} waiting for review.`}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map(({ href, icon: Icon, title, description, pending }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-foreground">{title}</h2>
                {pending > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">{pending}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
