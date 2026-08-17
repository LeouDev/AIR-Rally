import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listAllPaymentAccounts, getVenuePayoutReadiness } from "@/lib/services/venuePaymentAccounts";
import { PaymentAccountActions } from "@/components/admin/PaymentAccountActions";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import type { VenuePaymentAccountStatus } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payment Accounts" };

const STATUS_LABELS: Record<VenuePaymentAccountStatus, string> = {
  not_connected: "Not connected",
  pending_verification: "Pending",
  verified: "Verified",
  restricted: "Restricted",
  disabled: "Disabled",
};

const STATUS_STYLES: Record<VenuePaymentAccountStatus, string> = {
  not_connected: "bg-muted text-muted-foreground",
  pending_verification: "bg-warning/15 text-warning",
  verified: "bg-success/15 text-success",
  restricted: "bg-destructive/10 text-destructive",
  disabled: "bg-destructive/10 text-destructive",
};

const FILTERS: { value: VenuePaymentAccountStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not_connected", label: "Not connected" },
  { value: "pending_verification", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "restricted", label: "Restricted" },
];

function isStatus(value: string | undefined): value is VenuePaymentAccountStatus {
  return (
    value === "not_connected" ||
    value === "pending_verification" ||
    value === "verified" ||
    value === "restricted" ||
    value === "disabled"
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminPaymentAccountsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/payment-accounts");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const { status } = await searchParams;
  const activeFilter = isStatus(status) ? status : undefined;

  const [accounts, readiness] = await Promise.all([
    listAllPaymentAccounts(supabase, activeFilter),
    getVenuePayoutReadiness(supabase),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Back to moderation dashboard" />
      <div>
        <Link href="/admin/finance" className="text-sm text-muted-foreground hover:underline">
          ← Finance
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Payment accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Which venues can receive money. A venue must be verified before its earnings can enter a payout batch.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6">
          <dt className="text-xs text-muted-foreground">Venues ready</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{readiness.venuesReady}</dd>
        </div>
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <dt className="text-xs text-warning">Missing payment setup</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{readiness.venuesMissingSetup}</dd>
        </div>
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <dt className="text-xs text-warning">Blocked settlements</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {formatSettlementMoney(readiness.blockedSettlementAmount, "PHP")}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            {readiness.blockedSettlementCount} earned settlement(s) with nowhere to send the money.
          </p>
        </div>
      </dl>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const isActive = filter.value === "all" ? !activeFilter : activeFilter === filter.value;
          return (
            <Link
              key={filter.value}
              href={filter.value === "all" ? "/admin/payment-accounts" : `/admin/payment-accounts?status=${filter.value}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {accounts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No payment accounts match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Venue</th>
                <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Account ID</th>
                <th scope="col" className="px-4 py-3 font-medium">Created</th>
                <th scope="col" className="px-4 py-3 font-medium">Verified</th>
                <th scope="col" className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-4 py-3 text-foreground">{account.venueName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{account.ownerName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[account.status]}`}>
                      {STATUS_LABELS[account.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {account.paymongo_account_id ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(account.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(account.verified_at)}</td>
                  <td className="px-4 py-3">
                    <PaymentAccountActions venueId={account.venue_id} status={account.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Marking an account verified only makes its settlements eligible for a payout batch. No payout automation exists, so
        nothing here moves money.
      </p>
    </div>
  );
}
